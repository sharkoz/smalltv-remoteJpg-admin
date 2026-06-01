import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/http/server.js';
import { Engine } from '../src/app/engine.js';
import { ConfigStore } from '../src/config/store.js';
import { PluginRegistry } from '../src/plugins/registry.js';
import { loadPluginsFrom } from '../src/plugins/loader.js';
import { DataCache } from '../src/datasource/cache.js';
import { HttpFetcher } from '../src/datasource/fetcher.js';
import { ImageCache } from '../src/render/imageCache.js';
import { BrowserPool } from '../src/render/browser.js';
import { Renderer } from '../src/render/renderer.js';
import { SecretStore } from '../src/config/secrets.js';
import { FakeClock } from '../src/util/time.js';
import { chromiumAvailable } from './helpers/chromium.js';
import { jpegSize, isJpeg } from './helpers/jpeg.js';

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = join(here, '..', 'plugins');
const available = await chromiumAvailable();

describe.skipIf(!available)('end-to-end (real Chromium, full stack)', () => {
  let upstream: Server;
  let upstreamPort: number;
  let app: FastifyInstance;
  let pool: BrowserPool;
  let clock: FakeClock;
  let dir: string;

  beforeAll(async () => {
    // Mock upstream API: /ok returns JSON, /fail returns 500.
    upstream = createServer((req, res) => {
      if (req.url?.startsWith('/ok')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ rates: { EUR: 0.92 } }));
      } else {
        res.writeHead(500);
        res.end('boom');
      }
    });
    await new Promise<void>((r) => upstream.listen(0, r));
    upstreamPort = (upstream.address() as { port: number }).port;

    dir = mkdtempSync(join(tmpdir(), 'stv-e2e-'));
    const store = ConfigStore.load(join(dir, 'config.json'));
    store.upsertDashboard({
      id: 'clock-paris', pluginId: 'clock', name: 'Paris',
      config: { timezone: 'Europe/Paris', label: 'PARIS' }, displayDurationMs: 10_000,
    });
    store.upsertDashboard({
      id: 'fx-ok', pluginId: 'api-value', name: 'FX OK',
      config: { url: `http://127.0.0.1:${upstreamPort}/ok`, jsonPath: 'rates.EUR', label: 'EUR' },
      displayDurationMs: 15_000,
    });
    store.upsertDashboard({
      id: 'fx-fail', pluginId: 'api-value', name: 'FX Fail',
      config: { url: `http://127.0.0.1:${upstreamPort}/fail`, jsonPath: 'rates.EUR', label: 'EUR' },
      displayDurationMs: 15_000,
    });
    store.upsertDevice({
      id: 'dev', name: 'Dev', pollIntervalMs: 2000,
      assignments: [
        { dashboardId: 'clock-paris', displayDurationMs: 10_000 },
        { dashboardId: 'fx-ok', displayDurationMs: 15_000 },
      ],
    });
    store.upsertDevice({
      id: 'failDev', name: 'Fail Dev', pollIntervalMs: 2000,
      assignments: [{ dashboardId: 'fx-fail', displayDurationMs: 15_000 }],
    });

    const registry = new PluginRegistry();
    for (const p of await loadPluginsFrom(pluginsDir)) registry.register(p);

    clock = new FakeClock(0);
    pool = new BrowserPool();
    const engine = new Engine({
      store, registry,
      dataCache: new DataCache(new HttpFetcher(), clock),
      renderer: new Renderer(pool),
      imageCache: new ImageCache(clock),
      secrets: new SecretStore(undefined),
      clock,
    });
    await engine.tick(); // warm data + pre-render
    app = buildServer({ engine, store, registry });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.close();
    await new Promise<void>((r) => upstream.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves a valid 240x240 JPEG for the current dashboard', async () => {
    const res = await app.inject({ method: 'GET', url: '/devices/dev/screen.jpg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['x-dashboard-id']).toBe('clock-paris');
    const { width, height } = jpegSize(res.rawPayload);
    expect([width, height]).toEqual([240, 240]);
  });

  it('advances rotation to the next dashboard with different image bytes', async () => {
    const first = await app.inject({ method: 'GET', url: '/devices/dev/screen.jpg' });
    clock.advance(11_000); // past the 10s clock slot -> fx-ok
    const second = await app.inject({ method: 'GET', url: '/devices/dev/screen.jpg' });
    expect(second.headers['x-dashboard-id']).toBe('fx-ok');
    expect(Buffer.compare(first.rawPayload, second.rawPayload)).not.toBe(0);
  });

  it('returns a valid JPEG (HTTP 200) even when the data source fails', async () => {
    const res = await app.inject({ method: 'GET', url: '/devices/failDev/screen.jpg' });
    expect(res.statusCode).toBe(200);
    expect(isJpeg(res.rawPayload)).toBe(true);
  });
});
