# Repository Guidelines

## Project Overview

SmallTV Screens is a self-hosted Node/TypeScript server for 240x240 IoT displays. Devices poll `GET /devices/:id/screen.jpg`; the server selects a dashboard by wall-clock rotation, renders plugin HTML to JPEG through Playwright Chromium, and serves cached images. Admin users manage devices, dashboards, plugins, auth, and logs through `/admin/*` and `/admin/ui`.

Core model: `Device -> Assignment(displayDurationMs) -> Dashboard -> Plugin -> DataSource[]`.

## Architecture & Data Flow

- `src/index.ts` is the composition root. It wires `ConfigStore`, `SecretStore`, `PluginRegistry`, `BrowserPool`, `Renderer`, `ImageCache`, `DataCache(HttpFetcher)`, `LogStore`, `Engine`, `AuthService`, then `buildServer(...)`.
- Config loads from `CONFIG_PATH` or `config/config.json`, is validated by Zod, kept in memory, and persisted atomically by `src/config/store.ts`.
- Plugins load dynamically from `PLUGINS_DIR`/`plugins/` via `src/plugins/loader.ts`. Bad plugins are logged and skipped rather than crashing startup.
- `Engine.tick()` refreshes due data sources, invalidates images when values change, and pre-renders current/next dashboards. Device polling uses `engine.getScreenForDevice()` and cold-renders only on cache miss.
- Data source templates resolve `{{config.*}}`, `{{secret.*}}`, and `{{time.*}}`; failed fetches keep stale last-good data when available.
- Plugin `render(ctx)` receives `{ dashboardId, config, data, now, brick, log }`; output HTML is wrapped with `brick.screen()` and screenshotted to a fixed 240x240 JPEG.
- Auth protects admin/UI/log routes. `/devices/:id/screen.jpg`, `/health`, `/login`, and OAuth start/callback remain public by design.

## Key Directories

- `src/app/` — orchestration; `Engine` coordinates rotation, data, render, and caches.
- `src/http/` — Fastify server, public device endpoint, admin API, auth guard/routes, log WebSocket.
- `src/plugins/` — plugin ABI, loader/registry, brick HTML helpers.
- `plugins/` — built-in plugins (`clock`, `api-value`, `prometheus`).
- `src/datasource/` — HTTP fetching and stale-aware per-dashboard/source cache.
- `src/render/` — Playwright browser pool, JPEG renderer, image cache.
- `src/config/` — app config schema/store and secret/template resolution.
- `src/auth/` — auth config, password hashing, signed sessions, OAuth2.
- `src/rotation/` — pure rotation math and poll-skip warnings.
- `src/log/` — bounded log store and live subscribers.
- `src/ui/` — string-rendered login/admin pages; no frontend build pipeline.
- `test/` — Vitest unit/integration/UI/e2e tests plus fixtures/helpers.
- `scripts/` — dev helpers; `scripts/dev-poll.mjs` is the WSL/network-filesystem watcher fallback.

## Development Commands

```bash
npm install
npx playwright install chromium
npm run dev              # tsx watch src/index.ts
npm run dev:poll         # polling watcher for WSL2 /mnt/c or network filesystems
npm run build            # tsc -p tsconfig.json
npm run typecheck        # tsc -p tsconfig.json --noEmit
npm run test             # vitest run
npm run test:watch       # vitest
npm run set-password -- admin 'password'
npm run start            # node dist/index.js
```

Docker workflow:

```bash
docker build -t smalltv-screens .
docker run -p 8080:8080 -v "$PWD/config:/app/config" smalltv-screens
```

## Code Conventions & Common Patterns

- TypeScript is strict ESM/NodeNext. Source imports use `.js` specifiers, e.g. `import { Engine } from './app/engine.js'`.
- Prefer explicit dependency injection over globals: examples include `EngineDeps`, `RendererLike`, `Fetcher`, `Clock`, and `AuthServiceOptions`.
- Time-sensitive code should use injected `Clock`/`systemClock`; tests advance fake clocks instead of sleeping.
- Runtime state is in-memory maps/buffers plus JSON persistence (`PluginRegistry`, `DataCache`, `ImageCache`, `LogStore`, `ConfigStore`).
- Validate external/config boundaries with Zod: app config, auth config, plugin manifests, and plugin-specific dashboard config.
- Preserve graceful degradation: plugin load failures skip, data fetch failures become `ok:false` or stale data, render failures log and return placeholders where existing code does so.
- Startup/config correctness failures may be fatal; runtime poll/render paths should stay resilient and log actionable diagnostics.
- Naming is domain-focused (`Device`, `Dashboard`, `DashboardAssignment`, `RenderContext`, `DataSourceDecl`) and helper names are verb phrases (`computeCurrent`, `resolveTemplate`).
- HTML/UI is string-built with explicit escaping helpers; do not introduce a frontend framework unless the task explicitly requires it.

## Important Files

- `src/index.ts` — process entrypoint, env path resolution, subsystem wiring, watcher, shutdown.
- `src/app/engine.ts` — main scheduler/render/cache orchestration.
- `src/http/server.ts` — HTTP routes, admin API, plugin config validation, log WebSocket.
- `src/plugins/types.ts` — plugin API contract.
- `src/config/schema.ts`, `src/config/store.ts` — persisted app config model and atomic writes.
- `src/config/secrets.ts` — secret precedence and template resolution.
- `src/datasource/cache.ts`, `src/datasource/fetcher.ts` — fetch/cache/stale data semantics.
- `src/render/browser.ts`, `src/render/renderer.ts`, `src/render/imageCache.ts` — rendering pipeline and cache behavior.
- `src/auth/config.ts`, `src/auth/service.ts`, `src/auth/tokens.ts`, `src/auth/password.ts` — auth/session/OAuth implementation.
- `config/config.json` — starter app config.
- `config/auth.example.json` — auth/OAuth template; real `config/auth.json` is gitignored.
- `vitest.config.ts` — test selection/timeouts and single-fork pool for Chromium tests.
- `Dockerfile` — Playwright base image runtime/build container.
- `README.md` — user-facing architecture, config, plugin, API, and diagnostics docs.

## Runtime/Tooling Preferences

- Runtime: Node.js `>=20`, ESM (`"type": "module"`), TypeScript `NodeNext`, target `ES2022`.
- Package manager: npm (`package-lock.json` v3; Docker uses `npm ci`).
- No lint or format scripts/configs are present; do not invent lint/format commands.
- Default server env: `HOST=0.0.0.0`, `PORT=8080`; `NODE_ENV=production` disables dev plugin watching.
- Useful env overrides: `PLUGINS_DIR`, `CONFIG_PATH`, `SECRETS_PATH`, `AUTH_CONFIG_PATH`, `WATCH_POLLING=1`, `CHOKIDAR_USEPOLLING=true`, `ADMIN_USER`, `ADMIN_PASSWORD`, `AUTH_SESSION_SECRET`, `OAUTH2_CLIENT_SECRET`, `SECRET_<NAME>`.
- Playwright Chromium is required for real rendering. Outside Docker, install browser/system deps before render/e2e work.
- Secrets stay out of `config/config.json`; use env `SECRET_NAME` or `config/secrets.json` and reference them as `{{secret.name}}`.

## Testing & QA

- Framework: Vitest with TypeScript ESM imports using `.js` suffixes.
- Tests favor real stores/engine/server plus small fakes for renderer/fetcher; keep these DI seams intact.
- Filesystem tests use temp dirs and remove them in teardown. HTTP tests use `app.inject(...)` unless WebSocket/Playwright requires a bound random port.
- Browser-dependent tests use `test/helpers/chromium.ts` and skip when Chromium cannot launch; close apps, pages, browser pools, servers, and temp dirs.
- Avoid arbitrary sleeps. Use `FakeClock`, Fastify injection, WebSocket collectors, or Playwright waits tied to visible state.
- JPEG tests assert behavior (`image/jpeg`, dimensions, byte differences, headers like `X-Dashboard-Id`) rather than snapshots.
- Add/update focused tests for changed behavior, especially config validation, stale datasource behavior, auth protection/public endpoints, rotation edge cases, plugin schema/exampleConfig, and admin API/UI contracts.
