// =============================================================
//  Kindle Widget — Configuration
//  Edit this file to customise your dashboard.
//  All settings here apply to the Cloudflare Worker.
//  The local Flask server has its own config.py (same knobs).
// =============================================================

export const CONFIG = {

  // ── Display ────────────────────────────────────────────────
  // Page auto-refresh in seconds (delivered as <meta http-equiv="refresh">
  // so it works on old Kindle browsers with no JavaScript).
  refreshInterval: 60,

  // Dark mode: active when hour >= darkStart OR hour < darkEnd  (24 h)
  darkStart: 19,   // 7 PM
  darkEnd:   5,    // 5 AM

  // Rotate to a new quote every N minutes
  quoteRotationMinutes: 15,

  // Weekly deep-refresh: gives the e-ink panel a long pause to clear ghosting.
  // Fires on deepRefreshDay (0 = Mon … 6 = Sun) at deepRefreshHour:deepRefreshMinute.
  deepRefreshDay:      0,    // Monday
  deepRefreshHour:     2,
  deepRefreshMinute:   58,
  deepRefreshInterval: 600,  // seconds

  // First day of the calendar week: 0 = Sunday, 1 = Monday
  calendarWeekStart: 0,  // Sunday

  // ── Timezone ───────────────────────────────────────────────
  // IANA timezone string used for all time/date display.
  timezone: "Asia/Kolkata",

  // ── Weather ────────────────────────────────────────────────
  // Weather is shown only when an API key is available.
  // Without a key the dashboard works fine — just no weather panel.
  //
  // Recommended: set the key as a Wrangler secret (never hardcode in source):
  //   wrangler secret put OWM_API_KEY
  // Get a free key at https://openweathermap.org/api
  weather: {
    // Default location (used when no ?city= param is in the URL).
    // These are ignored if the user passes ?city=CityName.
    lat:   10.8761505928327,
    lon:   78.71708349267976,

    units: "metric",   // "metric" = °C, "imperial" = °F  (overridable via ?units=)

    // Leave empty — the Worker reads OWM_API_KEY from the Wrangler secret.
    // Only fill this in for quick local testing; never commit a real key.
    apiKey: "",
  },

  // ── Local Services ─────────────────────────────────────────
  // Shown only in LOCAL SERVER mode (app.py).
  // Each entry runs a shell command; output must be a single short line.
  //
  // Fields:
  //   label   – shown before the value
  //   command – shell command to run
  //   unit    – appended after the value (optional)
  //   action  – URL path that makes the label a clickable link (optional)
  //
  localServices: [
    {
      label:   "Battery",
      command: "/opt/tapo/bat_percentage.sh",
      unit:    "%",
    },
    {
      label:   "Source",
      command: "/opt/tapo/inverter.pl 2",
      action:  "/action/toggle_grid",   // clicking navigates here
    },
    {
      label:   "Grid",
      command: "ping -c 2 -q 192.168.0.133 > /dev/null 2>&1 && echo Present || echo N/A",
    },
  ],

  // ── Local Actions ──────────────────────────────────────────
  // Optional Flask routes that run shell commands (e.g. smart-plug toggle).
  // Only available in local server mode.
  //
  // Each entry: { route, commands: [array of shell strings] }
  //
  localActions: [
    {
      route: "/action/toggle_grid",
      commands: [
        "/usr/bin/python3 /opt/tapo/manage_p110.py --off",
        "/usr/bin/python3 /opt/tapo/p110.py",
      ],
    },
  ],

  // ── Local Server ───────────────────────────────────────────
  server: {
    host: "0.0.0.0",
    port: 8181,
  },
};
