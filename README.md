# Kindle Widget

A minimal, always-on dashboard designed for Kindle e-ink displays.  
Displays the time, date, calendar, and a rotating motivational quote.

**Works on old Kindle browsers** — no JavaScript, no modern CSS.  
Page auto-refresh is done entirely with `<meta http-equiv="refresh">` (server-side rendered).  
Weather and custom quotes are optional — the dashboard works fine with just time + calendar.

![Dashboard Screenshot](docs/screenshot.png)

---

## Features

- Large clock with AM/PM indicator
- Full month calendar (today highlighted, weekends shaded)
- Weather from OpenWeatherMap — optional, gracefully absent when no API key is set
- City override via URL param — point to any city without redeploying
- Custom quotes via URL param — host your own quote list as a GitHub Gist
- Rotating motivational quotes with built-in fallback list
- Dark mode automatically activates at night
- E-ink flash cycle (black → white) on quote rotation to clear ghosting
- Help page at `/help` listing all options
- All URL params persist across auto-refreshes — set once, works forever
- Local service monitoring via shell commands (battery %, inverter source, grid ping, etc.)
- Clickable local actions (e.g. toggle a smart plug) — local server only

---

## URL Parameters (Cloudflare Worker)

All parameters are optional. Set them in the browser address bar once — the page carries
them forward through every auto-refresh automatically.

| Parameter | What it does | Default |
|---|---|---|
| `tz` | Timezone for clock and calendar (IANA string, e.g. `America/New_York`) | `Asia/Kolkata` |
| `city` | City name for weather (e.g. `London`, `Tokyo`). Requires API key on server. | Server default location |
| `units` | `metric` (°C) or `imperial` (°F) | `metric` |
| `quotes` | Raw text URL with one quote per line — overrides built-in quotes | Built-in list |
| `refresh` | Page auto-refresh interval in seconds | `60` |

**Example URLs:**

```
# Time + calendar only (no weather needed)
https://kindle-widget.yourname.workers.dev/

# Weather for London in °F
https://kindle-widget.yourname.workers.dev/?city=London&units=imperial

# Custom timezone
https://kindle-widget.yourname.workers.dev/?tz=America/Chicago

# Custom quotes from a GitHub Gist
https://kindle-widget.yourname.workers.dev/?quotes=https://gist.githubusercontent.com/you/abc/raw/quotes.txt

# Everything together
https://kindle-widget.yourname.workers.dev/?tz=Europe/Berlin&city=Berlin&units=metric&quotes=https://gist.githubusercontent.com/you/abc/raw/quotes.txt
```

A `[?]` link in the top-right corner of the dashboard opens `/help` with the full reference.

---

## Deployment Options

### Option 1 — Cloudflare Workers (recommended, free, public URL)

Runs your dashboard as a serverless edge function.  
No server to maintain. Free tier covers ~100,000 requests/day.

**Requirements:** Node.js ≥ 18, a free [Cloudflare account](https://dash.cloudflare.com/sign-up)

```bash
# 1. Install Wrangler (Cloudflare's CLI)
npm install -g wrangler

# 2. Log in
wrangler login

# 3. Enter the worker directory
cd worker/

# 4. Install dependencies
npm install

# 5. (Optional) Set your OpenWeatherMap API key as a secret
#    Do NOT put the key in config.js or the URL — use a secret.
wrangler secret put OWM_API_KEY
# Paste your key when prompted, then press Enter.
# Without this, weather is simply hidden — everything else works.

# 6. Deploy
npm run deploy
```

Wrangler prints your Worker URL (e.g. `https://kindle-widget.yourname.workers.dev`).  
Open that URL on your Kindle.

**Local development:**
```bash
cd worker/
npm run dev
# Dashboard at http://localhost:8787
# Help page at http://localhost:8787/help
```

**Configuration** — edit `worker/config.js` for server-wide defaults:

| Setting | Description |
|---|---|
| `refreshInterval` | Default page reload interval in seconds |
| `darkStart` / `darkEnd` | Dark mode hours (24 h clock) |
| `quoteRotationMinutes` | How often the quote rotates |
| `timezone` | Default IANA timezone (overridable via `?tz=`) |
| `weather.lat` / `weather.lon` | Default location (overridable via `?city=`) |
| `weather.units` | Default unit — `"metric"` or `"imperial"` |
| `calendarWeekStart` | `0` = Sunday, `1` = Monday |

---

### Option 2 — Local Home Server (Node.js)

Run the **exact same Worker code** locally on a Raspberry Pi, NAS, or any always-on machine.  
Uses a thin Node.js HTTP adapter (`server.js`) — no separate framework, no duplicate logic.  
Your Kindle connects to it over Wi-Fi.

**Requirements:** Node.js ≥ 18

```bash
# 1. Enter the worker directory
cd worker/

# 2. Install dependencies
npm install

# 3. (Optional) Set your OpenWeatherMap API key
export OWM_API_KEY="your_key_here"

# 4. Run
npm run local
```

Dashboard is at `http://<your-server-ip>:8181` — point your Kindle browser there.  
Help page is at `http://<your-server-ip>:8181/help`.

All URL parameters (`?city=`, `?tz=`, `?quotes=`, `?units=`, `?refresh=`) work exactly
the same as the Cloudflare Worker version.

**Configuration** — edit `worker/config.js`:

- `server.port` — change the port (default 8181)
- `localServices` — shell-command-based status lines shown in the top-right panel
- `localActions` — URL routes that trigger shell commands (e.g. smart plug toggle)

> Local services and actions only run in `npm run local` mode.  
> They are ignored by the Cloudflare Worker (shell commands can't run in the cloud).

**Example: adding a CPU temperature service**
```js
// in worker/config.js → localServices:
{
  label:   "CPU Temp",
  command: "vcgencmd measure_temp | cut -d= -f2",
},
```

---

## Kindle Setup

### 1. Open the dashboard

In the Kindle browser, navigate to:
- **Cloudflare Workers:** `https://kindle-widget.yourname.workers.dev`
- **Local server:** `http://192.168.x.x:8181`

### 2. Disable auto-sleep

Old Kindles auto-sleep after a few minutes of inactivity, which stops the page from refreshing.

**Method A — older firmware:**
1. From the Kindle home screen, tap the **Search** box (magnifying glass).
2. Type `~ds` and press Search/Enter.
3. The screen flashes briefly — auto-sleep is now disabled.
4. Repeat `~ds` to re-enable.

**Method B — newer firmware (5.x+):**
1. In the search bar type `;ReadingTimeGoal off` and press Enter.
2. To re-enable: `;ReadingTimeGoal on`

> These are undocumented Kindle service commands. Try both if one doesn't work — behaviour
> varies by model and firmware version.

### 3. Keep the browser open

After navigating to the dashboard URL, just leave the Kindle on.  
The page refreshes itself automatically every 60 seconds (or whatever you set with `?refresh=`).

---

## Custom Quotes via GitHub Gist

1. Go to [gist.github.com](https://gist.github.com) and create a **public** Gist.
2. Paste your quotes — **one quote per line**.
3. Click **Raw** on the Gist page and copy that URL.
4. Add `?quotes=<raw-url>` to your dashboard URL.

The Worker fetches the file and caches it for 1 hour at Cloudflare's edge, so the
Kindle's 60-second refresh cycle never hammers your Gist URL.

**Example Gist URL:**
```
https://gist.githubusercontent.com/yourname/abc123def456/raw/quotes.txt
```

---

## Weather API

Weather is entirely optional. Without an API key the dashboard shows time, calendar and quotes.

1. Sign up for a free key at [openweathermap.org/api](https://openweathermap.org/api)
2. The free **"Current Weather Data"** plan is sufficient.
3. **Worker:** `wrangler secret put OWM_API_KEY`
4. **Local server:** `export OWM_API_KEY=...` or set `api_key` in `config.py`

> **Security:** Never put the API key in a URL parameter — it would be logged by servers
> and proxies along the way. Use a Wrangler secret for the Worker, or an environment
> variable for the local server.

---

## Project Structure

```
kindle-widget/
├── worker/
│   ├── index.js              # Cloudflare Worker + local server logic (shared)
│   ├── server.js             # Node.js HTTP adapter for local use (npm run local)
│   ├── config.js             # All configuration — Worker and local server
│   ├── quotes.js             # Built-in quote list
│   ├── wrangler.toml         # Cloudflare Worker deployment config
│   └── package.json          # npm scripts: local / dev / deploy
├── docs/
│   └── screenshot.png
├── README.md
```

---

## License

MIT
