/**
 * Kindle Widget — Cloudflare Worker
 *
 * Runs entirely server-side. Returns plain HTML with <meta http-equiv="refresh">
 * so it works on old Kindle browsers that have no JavaScript support.
 *
 * URL parameters (all optional):
 *   black=0|1     Internal e-ink flash cycle. Don't set manually.
 *   tz=Asia/Kolkata  Override timezone (IANA string).
 *   city=London      Show weather for this city (requires OWM_API_KEY secret).
 *   units=metric|imperial  Temperature unit (default: metric).
 *   quotes=<url>   Raw text URL (e.g. GitHub Gist) with one quote per line.
 *                  Overrides the built-in quote list.
 *   refresh=60     Page refresh interval in seconds.
 *
 * All params are forwarded in every meta-refresh so they persist across reloads.
 *
 * Deploy:  wrangler deploy
 * Dev:     wrangler dev
 */

import { CONFIG } from "./config.js";
import { QUOTES }  from "./quotes.js";

// ─── Time helpers ───────────────────────────────────────────────────────────

function nowInTZ(tz) {
  const d = new Date();

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
    hourCycle: "h23",
  }).formatToParts(d);

  const get = (type) => parseInt(parts.find(p => p.type === type)?.value ?? "0");

  const year   = get("year");
  const month  = get("month");   // 1-based
  const day    = get("day");
  const hour   = get("hour");    // 0-23
  const minute = get("minute");
  const second = get("second");

  const parts12 = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric", minute: "numeric",
    hour12: true,
  }).formatToParts(d);
  const hour12 = String(parseInt(parts12.find(p => p.type === "hour")?.value ?? "12")).padStart(2, "0");
  const ampm   = parts12.find(p => p.type === "dayperiod" || p.type === "dayPeriod")?.value ?? "AM";

  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const dayName3 = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  const weekday  = dayNames.indexOf(dayName3);

  return {
    year, month, day, hour, minute, second, weekday,
    hour12,
    ampm,
    minutePadded:  String(minute).padStart(2, "0"),
    monthName: new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long"  }).format(d),
    dayName:   new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(d),
  };
}

// ─── Calendar ───────────────────────────────────────────────────────────────

function buildCalendar(year, month, weekStart) {
  const firstDay    = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = (firstDay - weekStart + 7) % 7;

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(0);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(0);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ─── Quotes ─────────────────────────────────────────────────────────────────

// Fetch quotes from a user-supplied URL (raw text, one quote per line).
// Cached 1 hour at the edge so the Kindle's 60-second refresh doesn't hammer it.
async function fetchRemoteQuotes(url) {
  try {
    const resp = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!resp.ok) return null;
    const text = await resp.text();
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    return lines.length ? lines : null;
  } catch (_) {
    return null;
  }
}

function pickQuote(quotes, now) {
  const bucket = Math.floor(now.minute / CONFIG.quoteRotationMinutes);
  const seed   = now.year * 100000 + now.month * 1000 + now.day * 100 + now.hour * 10 + bucket;
  return quotes[seed % quotes.length];
}

// ─── Weather ────────────────────────────────────────────────────────────────

// Resolve a city name to lat/lon using OWM free geocoding API.
async function geocodeCity(city, apiKey) {
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}`;
  const resp = await fetch(url, { cf: { cacheTtl: 86400, cacheEverything: true } }); // cache 24h
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.length) return null;
  return { lat: data[0].lat, lon: data[0].lon, name: data[0].name, country: data[0].country };
}

async function fetchWeather(env, params) {
  const cfg    = CONFIG.weather;
  const apiKey = cfg.apiKey || (env && env.OWM_API_KEY) || "";
  if (!apiKey) return null;

  const units   = params.units || cfg.units;
  const city    = params.city  || "";

  let lat = cfg.lat;
  let lon = cfg.lon;
  let cityLabel = "";

  if (city) {
    const geo = await geocodeCity(city, apiKey);
    if (!geo) return null;
    lat = geo.lat;
    lon = geo.lon;
    cityLabel = `${geo.name}, ${geo.country}`;
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=${units}`;
    const resp = await fetch(url, { cf: { cacheTtl: 300 } }); // cache 5 min
    if (!resp.ok) return null;
    const data = await resp.json();

    const unit = units === "imperial" ? "°F" : "°C";
    return {
      temp:        `${Math.round(data.main.temp)}${unit}`,
      humidity:    `${data.main.humidity}%`,
      rain:        `${(data.rain?.["1h"] ?? 0).toFixed(1)} mm`,
      description: data.weather?.[0]?.description ?? "",
      city:        cityLabel || data.name || "",
    };
  } catch (_) {
    return null;
  }
}

// ─── URL helpers ─────────────────────────────────────────────────────────────

function paramsToQS(userParams, overrides = {}) {
  const merged = { ...userParams, ...overrides };
  return Object.entries(merged)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// ─── Misc ────────────────────────────────────────────────────────────────────

function isDarkMode(hour) {
  return hour >= CONFIG.darkStart || hour < CONFIG.darkEnd;
}

function calcRefreshSecs(now, overrideInterval) {
  const interval = overrideInterval || CONFIG.refreshInterval;
  const { deepRefreshDay, deepRefreshHour, deepRefreshMinute, deepRefreshInterval } = CONFIG;
  const pyDayOfWeek = now.weekday === 0 ? 6 : now.weekday - 1; // 0=Mon

  if (
    pyDayOfWeek  === deepRefreshDay   &&
    now.hour     === deepRefreshHour  &&
    now.minute   >= deepRefreshMinute
  ) {
    return deepRefreshInterval;
  }
  return Math.max(5, interval - now.second);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Help page ───────────────────────────────────────────────────────────────

function buildHelpHtml(workerUrl) {
  const base = workerUrl.replace(/\?.*$/, "");
  const eg   = (params) => escapeHtml(`${base}?${params}`);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Kindle Widget — Help</title>
  <style>
    body { font-family: sans-serif; background: white; color: black; padding: 20px; max-width: 700px; }
    h1   { font-size: 2em; }
    h2   { font-size: 1.4em; margin-top: 1.5em; border-bottom: 2px solid #ccc; padding-bottom: 4px; }
    table { border-collapse: collapse; width: 100%; font-size: 1em; margin-top: 0.5em; }
    th   { background: #474747; color: white; padding: 6px 10px; text-align: left; }
    td   { padding: 6px 10px; border: 1px solid #ccc; vertical-align: top; }
    tr:nth-child(even) td { background: #f4f4f4; }
    code { background: #eee; padding: 1px 4px; font-size: 0.95em; }
    .eg  { font-size: 0.85em; color: #555; word-break: break-all; }
    a    { color: black; }
    .back { margin-bottom: 1.5em; display: inline-block; font-size: 1.1em; }
  </style>
</head>
<body>
  <a class="back" href="/">&larr; Back to dashboard</a>
  <h1>Kindle Widget — Help</h1>
  <p>
    All options are passed as URL parameters. They persist across auto-refreshes —
    set them once in the browser address bar and the dashboard keeps them.
  </p>

  <h2>URL Parameters</h2>
  <table>
    <tr>
      <th>Parameter</th>
      <th>What it does</th>
      <th>Default</th>
    </tr>
    <tr>
      <td><code>tz</code></td>
      <td>
        Timezone for the clock and calendar.<br>
        Any <a href="https://en.wikipedia.org/wiki/List_of_tz_database_time_zones">IANA timezone string</a>.
      </td>
      <td><code>${escapeHtml(CONFIG.timezone)}</code></td>
    </tr>
    <tr>
      <td><code>city</code></td>
      <td>
        City name for weather. Requires an OWM API key to be configured on the server
        (set via <code>wrangler secret put OWM_API_KEY</code>).
        If no key is available, weather is hidden regardless.
      </td>
      <td>Server default location</td>
    </tr>
    <tr>
      <td><code>units</code></td>
      <td>
        Temperature unit: <code>metric</code> (°C) or <code>imperial</code> (°F).
      </td>
      <td><code>${escapeHtml(CONFIG.weather.units)}</code></td>
    </tr>
    <tr>
      <td><code>quotes</code></td>
      <td>
        URL of a plain-text file with one quote per line
        (e.g. a raw GitHub Gist URL). Overrides the built-in quote list.
        The file is fetched once and cached for 1 hour at the edge.
      </td>
      <td>Built-in quotes</td>
    </tr>
    <tr>
      <td><code>refresh</code></td>
      <td>
        Page auto-refresh interval in seconds. Minimum 5.
      </td>
      <td><code>${CONFIG.refreshInterval}</code></td>
    </tr>
  </table>

  <h2>Example URLs</h2>
  <p class="eg">Time + calendar only (no weather):<br>
    <code>${eg("tz=America/New_York")}</code>
  </p>
  <p class="eg">Weather for London in °F:<br>
    <code>${eg("city=London&units=imperial")}</code>
  </p>
  <p class="eg">Custom quotes from a GitHub Gist:<br>
    <code>${eg("quotes=https://gist.githubusercontent.com/you/abc123/raw/quotes.txt")}</code>
  </p>
  <p class="eg">Everything together:<br>
    <code>${eg("tz=Europe/Berlin&city=Berlin&units=metric&quotes=https://gist.githubusercontent.com/you/abc123/raw/quotes.txt&refresh=120")}</code>
  </p>

  <h2>Kindle Tips</h2>
  <ul>
    <li>
      <b>Disable auto-sleep:</b> In the Kindle search bar type
      <code>~ds</code> and press Search. The screen will flash — auto-sleep is off.
      Type <code>~ds</code> again to re-enable it.
      On newer firmware try <code>;ReadingTimeGoal off</code> instead.
    </li>
    <li>
      <b>Keep the browser open:</b> After navigating to the dashboard URL,
      just leave the Kindle on. The page refreshes itself every ${CONFIG.refreshInterval} seconds
      (or whatever you set with <code>refresh=</code>).
    </li>
    <li>
      <b>Dark mode:</b> Activates automatically between
      ${CONFIG.darkStart}:00 and ${CONFIG.darkEnd}:00 in your configured timezone.
    </li>
    <li>
      <b>Weather API key:</b> Get a free key at
      <a href="https://openweathermap.org/api">openweathermap.org/api</a>
      and add it with <code>wrangler secret put OWM_API_KEY</code>.
      Never put the key in a URL — it would be visible in server logs.
    </li>
  </ul>

  <h2>Custom Quotes (GitHub Gist)</h2>
  <ol>
    <li>Go to <a href="https://gist.github.com">gist.github.com</a> and create a new Gist.</li>
    <li>Add one quote per line, save as a public Gist.</li>
    <li>Click <b>Raw</b> and copy that URL.</li>
    <li>Add <code>?quotes=&lt;raw-url&gt;</code> to the dashboard URL.</li>
  </ol>
</body>
</html>`;
}

// ─── Main HTML ───────────────────────────────────────────────────────────────

function buildHtml({ now, weather, quote, darkMode, refreshSecs, black, reqBlack, userParams, localServices }) {
  const bg = (darkMode || black === "1") ? "black" : "white";
  const fg = (darkMode || black === "1") ? "white" : "black";

  const nextQS     = paramsToQS(userParams, { black: "0" });
  const flashQS    = paramsToQS(userParams, { black: "1" });
  const mainUrl    = `/?${nextQS}`;
  const flashUrl   = `/?${flashQS}`;

  const metaRefresh = black === "1"
    ? `<meta http-equiv="refresh" content="1;url=${escapeHtml(mainUrl)}">`
    : `<meta http-equiv="refresh" content="${refreshSecs};url=${escapeHtml(black === "0" && reqBlack === "1" ? flashUrl : mainUrl)}">`;

  // Calendar
  const weekStart = CONFIG.calendarWeekStart;
  const dayNames  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const rotated   = [...dayNames.slice(weekStart), ...dayNames.slice(0, weekStart)];
  const headers   = rotated.map(n =>
    `<th style="padding:4px;width:80px;background:#474747;color:white;border:3px solid #aaa;">${n}</th>`
  ).join("");

  const isWeekendCol = (colIdx) => {
    const orig = (colIdx + weekStart) % 7;
    return orig === 0 || orig === 6;
  };

  const matrix = buildCalendar(now.year, now.month, weekStart);
  const calRows = matrix.map(week => {
    const cells = week.map((day, colIdx) => {
      let cellBg = bg, cellFg = fg;
      if (isWeekendCol(colIdx))  { cellBg = "#474447"; cellFg = "white"; }
      if (day === now.day)        { cellBg = darkMode ? "white" : "black"; cellFg = darkMode ? "black" : "white"; }
      const style = `padding:4px;border:3px solid #aaa;width:100px;height:50px;font-size:1.2em;text-align:center;background:${cellBg};color:${cellFg};`;
      return `<td style="${style}">${day || ""}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  // Top-right panel: local services > weather > empty
  const topRight = (() => {
    if (localServices && localServices.length) {
      return localServices.map(svc => {
        const val = escapeHtml(svc.value);
        const content = svc.action
          ? `<a href="${escapeHtml(svc.action)}">${val}</a>`
          : val;
        return `<span>${escapeHtml(svc.label)}: ${content}</span>`;
      }).join("<br>");
    }
    if (weather) {
      return `<span>${escapeHtml(weather.temp)}</span><br>
       <span>H: ${escapeHtml(weather.humidity)}</span><br>
       <span>R: ${escapeHtml(weather.rain)}</span>`;
    }
    return `<span style="font-size:0.9em;color:#888;">no weather</span>`;
  })();

  const weatherBar = weather ? `
  <div class="section center">
    <p style="font-size:1.1em;">
      ${escapeHtml(weather.description)}${weather.city ? " &mdash; " + escapeHtml(weather.city) : ""}
    </p>
  </div>` : "";

  // Help link — small, tucked in top-right corner, inherits color
  const helpQS   = paramsToQS(userParams);
  const helpHref = `/help${helpQS ? "?" + helpQS : ""}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${metaRefresh}
  <title>Kindle Dashboard</title>
  <style>
    body {
      color: ${fg};
      background: ${bg};
      font-family: sans-serif;
      padding-top: 5px;
      width: 100%; height: 100%; overflow: hidden;
      position: relative;
    }
    p { font-size: 1.5em; }
    .center { text-align: center; }
    .section { margin-top: 2px; }
    .time  { font-size: 7em; }
    .day   { font-size: 2em; margin-top: -10px; }
    .month { font-size: 1.5em; margin-top: -10px; }
    .column { float: left; }
    .col1 { width: 500px; }
    .col2 { width: 200px; margin-left: 20px; }
    .row:after { content: ""; display: table; clear: both; }
    a { color: inherit; text-decoration: none; }
    .help-link {
      position: absolute; top: 6px; right: 10px;
      font-size: 1em; border: 1px solid ${fg};
      padding: 2px 7px; opacity: 0.5;
    }
  </style>
</head>
<body>
  <a class="help-link" href="${escapeHtml(helpHref)}">?</a>

  <div style="margin-top:-40px;"></div>

  <div class="row">
    <div class="column col1">
      <span class="time">${now.hour12}:${now.minutePadded}</span>
      <small>${now.ampm}</small>
    </div>
    <div class="column col2">
      <p>${topRight}</p>
    </div>
  </div>

  <div style="margin-top:-40px;"></div>

  <div class="section center">
    <span class="day">${escapeHtml(now.dayName)}, ${now.day}</span>
    &nbsp;
    <span class="month">${escapeHtml(now.monthName)} ${now.year}</span>
  </div>

  <div class="section center">
    <table style="margin:0 auto;border-collapse:collapse;font-size:1.3em;">
      <tr>${headers}</tr>
      ${calRows}
    </table>
  </div>

  ${weatherBar}

  <div class="section center">
    <p><q style="width:700px;">${escapeHtml(quote)}</q></p>
  </div>
</body>
</html>`;
}

// ─── Worker Entry Point ──────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── /help route ──────────────────────────────────────────
    if (url.pathname === "/help") {
      return new Response(buildHelpHtml(url.href), {
        headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-store" },
      });
    }

    // ── Parse user-supplied params ────────────────────────────
    // These are forwarded in every meta-refresh so they persist.
    const black   = url.searchParams.get("black")   ?? "1";
    const tz      = url.searchParams.get("tz")      || CONFIG.timezone;
    const city    = url.searchParams.get("city")    || "";
    const units   = url.searchParams.get("units")   || CONFIG.weather.units;
    const quotesUrl = url.searchParams.get("quotes") || "";
    const refreshOverride = parseInt(url.searchParams.get("refresh") || "0") || 0;

    // Collect only the params the user actually set (skip internal `black`)
    const userParams = {};
    if (url.searchParams.get("tz"))      userParams.tz      = tz;
    if (url.searchParams.get("city"))    userParams.city    = city;
    if (url.searchParams.get("units"))   userParams.units   = units;
    if (url.searchParams.get("quotes"))  userParams.quotes  = quotesUrl;
    if (url.searchParams.get("refresh")) userParams.refresh = String(refreshOverride);

    // Validate timezone — fall back to config default if invalid
    let safeTz = CONFIG.timezone;
    try {
      Intl.DateTimeFormat("en-US", { timeZone: tz });
      safeTz = tz;
    } catch (_) {}

    // ── Gather data (parallel where possible) ─────────────────
    const now = nowInTZ(safeTz);

    const [quotesArr, weather] = await Promise.all([
      quotesUrl ? fetchRemoteQuotes(quotesUrl) : Promise.resolve(null),
      fetchWeather(env, { city, units }),
    ]);

    const quotes        = quotesArr ?? QUOTES;
    const quote         = pickQuote(quotes, now);
    const localServices = env._localServices ?? null;  // injected by server.js

    const dark    = isDarkMode(now.hour);
    const secs    = calcRefreshSecs(now, refreshOverride);
    const atBoundary = now.minute % CONFIG.quoteRotationMinutes === 0;
    const reqBlack   = (atBoundary && !dark) ? "1" : "0";

    const html = buildHtml({
      now, weather, quote,
      darkMode: dark,
      refreshSecs: secs,
      black, reqBlack,
      userParams,
      localServices,
    });

    return new Response(html, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "Cache-Control": "no-store",
      },
    });
  },
};
