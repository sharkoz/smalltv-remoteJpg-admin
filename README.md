# SmallTV Screens

Self-hosted dashboard server for SmallTV-style **240×240 IoT screens** that poll a URL and display the returned JPG.

Define multiple **devices**, give each an ordered list of full-screen **dashboards**, and the server rotates them on a carousel. Each dashboard is a **code plugin** (HTML/CSS/JS) — a clock, an API value, anything you can render. A device just polls one URL and always gets the currently-active image.

```
Device ──< Assignment (duration) >── Dashboard ──> Plugin ──> DataSource[]
```

## How it works

- A device polls `GET /devices/:id/screen.jpg` on its own interval.
- The server tracks the **current** dashboard for that device from wall-clock time and per-slot durations (deterministic, survives restarts).
- Dashboards are rendered to JPG **ahead of time** by a shared headless Chromium and cached. The poll path only reads the cache (plus a one-time cold-start render).
- Data sources are fetched on their own interval; a failed fetch keeps the last good value (flagged stale) so screens **degrade gracefully** instead of going blank.

> **Rotation tip:** set each device's `pollIntervalMs` ≤ the shortest slot duration, or the device may poll too rarely and skip dashboards. The admin API warns when a slot is shorter than the poll interval.

## Quick start (local dev)

```bash
npm install
npx playwright install chromium          # browser binary
# On a bare Linux host you also need system libs (skip in Docker):
sudo npx playwright install-deps chromium

npm run dev                              # tsx watch, hot-reloads plugins
# device endpoint:
curl -o screen.jpg http://localhost:8080/devices/kitchen-tv/screen.jpg
```

A starter `config/config.json` ships with two clocks and a USD→EUR rate, assigned to a `kitchen-tv` device.

### Auto-reload not working? (WSL2 / network mounts)

`npm run dev` (tsx watch → Node `--watch`) relies on inotify file events. On **WSL2 when the project lives under `/mnt/c`** (a `9p`/`drvfs` mount), and on some network/virtual filesystems, those events are **never delivered**, so nothing reloads.

- **Best fix:** keep the repo on the **Linux filesystem**, e.g. `~/workspace/smalltv-screens`, not `/mnt/c/...`. Native inotify works (and I/O is much faster). To move it:
  ```bash
  cp -r /mnt/c/Users/<you>/workspace/smalltv-screens ~/workspace/smalltv-screens
  cd ~/workspace/smalltv-screens && npm install
  ```
- **If you must stay on `/mnt/c`:** use the polling runner, which restarts on `src/` changes and hot-reloads `plugins/` in-process:
  ```bash
  npm run dev:poll
  ```
  (Equivalently, `WATCH_POLLING=1` enables polling for the in-app plugin watcher.)

## Docker (recommended for deployment)

The Playwright base image bundles Chromium and all system libraries.

```bash
docker build -t smalltv-screens .
docker run -p 8080:8080 -v "$PWD/config:/app/config" smalltv-screens
```

## Admin web UI & authentication

A web admin is served at **`/admin/ui`** to manage devices, dashboards and plugins (live previews, create/edit/delete, rotation slots). The device poll endpoint stays public; everything under `/admin/*` and the UI require a login.

**Set a password:**
```bash
npm run set-password -- admin 'your-password'   # writes hashed creds to config/auth.json
```
Or for a quick start, set `ADMIN_USER` / `ADMIN_PASSWORD` env vars. If nothing is configured, a temporary admin password is generated and printed in the logs on startup (so the UI is never left open). Set `AUTH_SESSION_SECRET` so sessions survive restarts.

**OAuth2 (optional):** copy `config/auth.example.json` to `config/auth.json`, set `oauth2.enabled: true`, fill in your provider's `authorizationUrl` / `tokenUrl` / `userInfoUrl` / `clientId` / `clientSecret`, and list permitted identities in `allowedEmails` (deny-by-default). Register your provider redirect URI as `http(s)://<host>/auth/oauth2/callback`. The login page then shows a "Sign in" button. The client secret can also come from `OAUTH2_CLIENT_SECRET`.

Sessions are stateless signed cookies (HMAC); passwords are hashed with scrypt — no extra dependencies.

## Configuration

`config/config.json` (validated on load, written atomically):

```jsonc
{
  "version": 1,
  "dashboards": [
    { "id": "clock-paris", "pluginId": "clock", "name": "Paris",
      "config": { "timezone": "Europe/Paris", "label": "PARIS" }, "displayDurationMs": 10000 }
  ],
  "devices": [
    { "id": "kitchen-tv", "name": "Kitchen", "pollIntervalMs": 5000,
      "assignments": [{ "dashboardId": "clock-paris", "displayDurationMs": 10000 }] }
  ]
}
```

**Secrets** are never stored in config. Reference them in a plugin's data-source URL/headers as `{{secret.name}}` and provide the value via env (`SECRET_NAME`) or `config/secrets.json` (gitignored).

## Writing a plugin

A plugin is a directory under `plugins/<id>/` with an `index.ts` exporting a `manifest` and a `render` function:

```ts
import { z } from 'zod';
import type { PluginManifest, RenderFn } from '../../src/plugins/types.js';

const configSchema = z.object({ label: z.string().default('') });

export const manifest: PluginManifest = {
  id: 'my-plugin',
  name: 'My Plugin',
  defaultDisplayDurationMs: 10_000,
  rerenderIntervalMs: 1_000,            // optional fixed re-render cadence
  dataSources: [                        // optional declared HTTP dependencies
    { id: 'main', url: '{{config.url}}', refreshIntervalMs: 60_000, responseType: 'json' },
  ],
  configSchema,
};

export const render: RenderFn = (ctx) => {
  const cfg = configSchema.parse(ctx.config);
  return ctx.brick.screen(
    ctx.brick.stack([
      ctx.brick.text({ content: cfg.label, size: 18 }),
      ctx.brick.value({ source: 'main', path: 'price', fallback: '—' }),
    ]),
  );
};
```

- `render` returns an HTML document (or a fragment, auto-wrapped to 240×240).
- `ctx.data[sourceId]` holds the resolved fetch result (`ok`, `value`, `stale`, `error`).
- `ctx.now` is an injected clock — use it instead of `new Date()`.
- `ctx.log.{debug,info,warn,error}(msg, meta?)` emits diagnostics that show up per-dashboard in the admin **Logs** panel — use it to explain fallbacks/empty states.
- **Bricks** (`text`, `value`, `stack`, `row`, `screen`) are reusable HTML-emitting units; the same brick layer is what a future visual builder will target, so code plugins and the builder share one rendering substrate.

Preview a single dashboard while authoring: `GET /admin/dashboards/:id/preview.jpg`.

### Placeholders in data-source URLs/headers

Data-source `url` and `headers` support these placeholders, resolved per render:

- `{{config.x.y}}` — a value from the dashboard config.
- `{{secret.name}}` — a secret from env (`SECRET_NAME`) or `config/secrets.json`.
- `{{time.now}}` / `{{time.nowMs}}` — current Unix time (seconds / ms).
- `{{time.rangeStart}}` — `now − config.rangeSeconds` (default 1h), for range queries.
- Append `|url` to percent-encode a value, e.g. `{{config.query|url}}`.

### Built-in plugins

- **clock** — timezone clock, no data source.
- **api-value** — shows one value from a JSON API (`jsonPath`), with stale/fallback handling.
- **ai-usage** — shows Claude Code and/or OpenAI Codex subscription quota usage on a 240×240 dashboard. It reads local CLI OAuth credentials (`~/.claude/.credentials.json` and/or `~/.codex/auth.json`), keeps tokens out of `config/config.json`, and displays 5h + 7d usage windows with stale/error fallbacks. Example dashboard config:
  ```json
  {
    "providers": ["claude", "codex"],
    "title": "AI Usage",
    "mode": "auto",
    "showCredits": true,
    "showReview": true,
    "theme": "dark"
  }
  ```
- **prometheus** — graphs a PromQL query as an SVG sparkline via the Prometheus
  `query_range` API. Config: `baseUrl`, `query`, `rangeSeconds` (window), `step`,
  `label`, `unit`, `color`, `decimals`. Example dashboard config:
  ```json
  { "baseUrl": "http://prometheus:9090",
    "query": "rate(node_cpu_seconds_total{mode=\\"idle\\"}[5m])",
    "rangeSeconds": 3600, "step": 60, "label": "CPU", "unit": "%", "color": "#4f9eff" }
  ```
  Degrades to a "no data" card if the query returns nothing or the server is unreachable.

## Admin API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/devices/:id/screen.jpg` | The image a device polls |
| GET | `/health` | Liveness |
| GET | `/admin/plugins` | List loaded plugins |
| GET/POST | `/admin/devices` | List / upsert devices |
| DELETE | `/admin/devices/:id` | Remove a device |
| GET/POST | `/admin/dashboards` | List / upsert dashboards |
| DELETE | `/admin/dashboards/:id` | Remove a dashboard |
| GET | `/admin/dashboards/:id/preview.jpg` | Render one dashboard (bypasses rotation) |
| GET | `/admin/logs?dashboardId=&level=&limit=` | Recent log entries (newest first) |
| WS | `/admin/logs/stream` | Live log stream: a `backlog` message on connect, then an `entry` per new log |

## Logs & diagnostics

The server keeps a ring buffer of recent logs, **streamed live to the admin UI over a WebSocket** (`/admin/logs/stream`) — no polling. The UI keeps a buffer and filters by dashboard/level client-side; click **Logs** on a dashboard card to focus it. (A `GET /admin/logs` REST endpoint is also available for one-off queries.) It captures:

- **datasource** — every fetch outcome per dashboard (the URL *template* — never the resolved value, so secrets don't leak — plus HTTP status / network cause like `ECONNREFUSED host:port`).
- **plugin** — whatever a plugin emits via `ctx.log`. The built-in **prometheus** plugin explains a "no data" precisely: fetch failed (unreachable), query error (`status:error` from Prometheus), query matched no series, or no samples in the range.
- **render** — render failures.

So when a Prometheus dashboard shows "no data", open its logs: you'll see whether the server was unreachable, the PromQL was rejected, or the query simply matched nothing.

## Tests

```bash
npm test          # unit + integration
npm run typecheck
```

Browser-dependent tests (render + full e2e) **skip automatically** if Chromium can't launch (missing system libs), and run in Docker or after `playwright install-deps`. Everything else — config, secrets, plugin loading, datasource caching, rotation math, engine orchestration, HTTP routes — runs everywhere with fakes.

## Roadmap

- Visual drag-and-drop dashboard builder on top of the existing brick system.
- More built-in bricks (icons, gauges, sparklines) and plugins.
