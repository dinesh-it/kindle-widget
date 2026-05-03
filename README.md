# Kindle Widget

A minimal, always-on dashboard for Kindle e-ink displays.  
Shows the time, date, calendar, and rotating quotes — rendered server-side with no JavaScript.

![Dashboard Screenshot](docs/screenshot.png)

---

## Try it now

Open this URL in your Kindle browser — no setup, no account, no API key:

```
https://kw.dineshdtech.in
```

---

## Kindle Setup

### 1. Open the dashboard

In the Kindle browser, navigate to your chosen URL:
- **Public instance (ready to use):** `https://kw.dineshdtech.in`
- **Your own Cloudflare Worker:** `https://kindle-widget.yourname.workers.dev`
- **Local home server:** `http://192.168.x.x:8181`

### 2. Disable auto-sleep

Old Kindles sleep after a few minutes of inactivity, which stops the page from refreshing.

**Method A — older firmware:**
1. Tap the **Search** box on the home screen.
2. Type `~ds` and press Enter. The screen flashes — done.
3. Repeat `~ds` to re-enable.

**Method B — newer firmware (5.x+):**
1. In the search bar type `;ReadingTimeGoal off` and press Enter.
2. To re-enable: `;ReadingTimeGoal on`

> These are undocumented Kindle service commands. Try both if one doesn't work — behaviour varies by model and firmware version.

### 3. Leave it open

The page auto-refreshes every 60 seconds. Just leave the Kindle on with the browser open.

---

## URL Parameters

All parameters are optional. Set them once in the address bar — the page carries them through every auto-refresh.

| Parameter | What it does | Default |
|---|---|---|
| `tz` | Timezone (IANA string, e.g. `America/New_York`) | `Asia/Kolkata` |
| `city` | City name for weather (requires API key on server) | Server default |
| `units` | `metric` (°C) or `imperial` (°F) | `metric` |
| `quotes` | Raw text URL with one quote per line | Built-in list |
| `refresh` | Auto-refresh interval in seconds | `60` |

**Examples:**

```
# Custom timezone
https://kw.dineshdtech.in/?tz=America/New_York

# Custom quotes from a GitHub Gist
https://kw.dineshdtech.in/?quotes=https://gist.githubusercontent.com/you/abc/raw/quotes.txt

# Everything together
https://kw.dineshdtech.in/?tz=Europe/Berlin&quotes=https://gist.githubusercontent.com/you/abc/raw/quotes.txt
```

A `[?]` link in the top-right corner opens `/help` with the full parameter reference.

---

## Features

- Large clock with AM/PM indicator
- Full month calendar — today highlighted, weekends shaded
- Weather from OpenWeatherMap — optional, hidden gracefully when no key is set
- Dark mode automatically activates at night
- E-ink flash cycle on quote rotation to clear ghosting
- All URL params persist across auto-refreshes — set once, works forever
- Local service monitoring (battery %, inverter source, grid ping, etc.) — local server only
- Clickable local actions (e.g. smart plug toggle) — local server only

---

## Self-Hosting

### Option 1 — Cloudflare Workers (recommended, free, public URL)

Serverless edge function. Free tier covers ~100,000 requests/day. No server to maintain.

**Requirements:** Node.js ≥ 18, a free [Cloudflare account](https://dash.cloudflare.com/sign-up)

```bash
npm install -g wrangler
wrangler login
npm install

# Optional: set your OpenWeatherMap API key
wrangler secret put OWM_API_KEY

npm run deploy
```

Wrangler prints your Worker URL — open that on your Kindle.

**Local dev:**
```bash
npm run dev
# http://localhost:8787
```

### Option 2 — Local Home Server (Node.js)

Run on a Raspberry Pi, NAS, or any always-on machine. Your Kindle connects over Wi-Fi.

**Requirements:** Node.js ≥ 18

```bash
npm install
export OWM_API_KEY="your_key_here"   # optional
npm run local
# http://<your-server-ip>:8181
```

---

## Configuration

Edit `config.js` for server-wide defaults:

| Setting | Description |
|---|---|
| `refreshInterval` | Default page reload interval in seconds |
| `darkStart` / `darkEnd` | Dark mode hours (24 h clock) |
| `quoteRotationMinutes` | How often the quote rotates |
| `timezone` | Default IANA timezone (overridable via `?tz=`) |
| `weather.lat` / `weather.lon` | Default location (overridable via `?city=`) |
| `weather.units` | `"metric"` or `"imperial"` |
| `calendarWeekStart` | `0` = Sunday, `1` = Monday |
| `server.port` | Local server port (default `8181`) |
| `localServices` | Shell commands shown as status lines (local only) |
| `localActions` | URL routes that trigger shell commands (local only) |

**Example: adding a CPU temperature service**
```js
// config.js → localServices:
{ label: "CPU Temp", command: "vcgencmd measure_temp | cut -d= -f2" }
```

---

## Custom Quotes

1. Create a **public** Gist at [gist.github.com](https://gist.github.com) — one quote per line.
2. Click **Raw** and copy the URL.
3. Add `?quotes=<raw-url>` to your dashboard URL.

The Worker caches the Gist for 1 hour so the Kindle's 60-second refresh never hammers the URL.

---

## Weather API

Weather is optional — the dashboard works fine without it.

1. Get a free key at [openweathermap.org/api](https://openweathermap.org/api) (Current Weather Data plan).
2. **Worker:** `wrangler secret put OWM_API_KEY`
3. **Local server:** `export OWM_API_KEY=...`

> Never put the key in a URL parameter — use a Wrangler secret or environment variable.

---

## Project Structure

```
kindle-widget/
├── index.js          # Cloudflare Worker + local server logic (shared)
├── server.js         # Node.js HTTP adapter (npm run local)
├── config.js         # All configuration
├── quotes.js         # Built-in quote list
├── wrangler.toml     # Cloudflare Worker deployment config
└── package.json      # npm scripts: local / dev / deploy
```

---

## License

MIT
