/**
 * Local development server — wraps the Cloudflare Worker in a plain Node.js
 * HTTP server so you can run `npm run local` without Wrangler or Python.
 *
 * The Worker's fetch(request, env) is called for all routes except:
 *   - Local action routes (defined in config.localActions) — run shell commands
 *
 * Local services (config.localServices) are fetched via child_process and
 * injected into the Worker response by overriding the env object with a
 * special `_localServices` key that index.js reads when present.
 *
 * Environment variables are read from process.env.
 * For convenience, create a .env file and run with:
 *   node --env-file=.env server.js   (Node >= 20.6)
 * or set them in your shell:
 *   OWM_API_KEY=xxx npm run local
 */

import http       from "node:http";
import { exec }   from "node:child_process";
import { promisify } from "node:util";
import worker     from "./index.js";
import { CONFIG } from "./config.js";

const execAsync = promisify(exec);

const PORT = parseInt(process.env.PORT || CONFIG.server?.port || 8181);
const HOST = process.env.HOST || CONFIG.server?.host || "0.0.0.0";

const env = {
  OWM_API_KEY: process.env.OWM_API_KEY || "",
};

// Run a single local service command, return its trimmed output or "—"
async function runService(command) {
  try {
    const { stdout } = await execAsync(command, { timeout: 5000 });
    return stdout.trim() || "—";
  } catch (_) {
    return "—";
  }
}

// Fetch all local services in parallel
async function fetchLocalServices() {
  const services = CONFIG.localServices ?? [];
  const results  = await Promise.all(
    services.map(async (svc) => ({
      label:  svc.label,
      value:  `${await runService(svc.command)}${svc.unit ?? ""}`,
      action: svc.action ?? null,
    }))
  );
  return results;
}

// Build a map of action route → commands from config
const actionRoutes = new Map(
  (CONFIG.localActions ?? []).map((a) => [a.route, a.commands])
);

const server = http.createServer(async (req, res) => {
  const base    = `http://${req.headers.host || `localhost:${PORT}`}`;
  const url     = new URL(req.url, base);
  const pathname = url.pathname;

  // ── Local action routes ────────────────────────────────────
  if (actionRoutes.has(pathname)) {
    const commands = actionRoutes.get(pathname);
    for (const cmd of commands) {
      try { await execAsync(cmd, { timeout: 10000 }); } catch (e) {
        console.error(`Action error (${cmd}):`, e.message);
      }
    }
    // Redirect back to dashboard, preserving any query params except the route
    const qs = url.searchParams.toString();
    res.writeHead(302, { Location: qs ? `/?${qs}` : "/" });
    res.end();
    return;
  }

  // ── All other routes → Worker ──────────────────────────────
  // Fetch local service values in parallel with building the request
  const [localServices] = await Promise.all([
    fetchLocalServices(),
  ]);

  const request = new Request(url.toString(), {
    method:  req.method,
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k, Array.isArray(v) ? v.join(", ") : v,
      ])
    ),
  });

  // Pass local services to the Worker via env (Worker checks for this key)
  const localEnv = { ...env, _localServices: localServices };

  try {
    const response = await worker.fetch(request, localEnv);
    const body     = await response.text();
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(body);
  } catch (err) {
    console.error("Worker error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal server error\n" + err.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Kindle Widget  →  http://localhost:${PORT}`);
  console.log(`Help page      →  http://localhost:${PORT}/help`);
  if (!env.OWM_API_KEY) {
    console.log("Tip: set OWM_API_KEY to enable weather.");
    console.log("     OWM_API_KEY=your_key npm run local");
  }
});
