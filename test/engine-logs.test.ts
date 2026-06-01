import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/app/engine.js';
import { buildServer } from '../src/http/server.js';
import { ConfigStore } from '../src/config/store.js';
import { PluginRegistry } from '../src/plugins/registry.js';
import { loadPluginsFrom } from '../src/plugins/loader.js';
import { DataCache } from '../src/datasource/cache.js';
import { ImageCache } from '../src/render/imageCache.js';
import { SecretStore } from '../src/config/secrets.js';
import { FakeClock } from '../src/util/time.js';
import type { RendererLike } from '../src/render/renderer.js';
import type { Fetcher, FetchOutcome } from '../src/datasource/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = join(here, '..', 'plugins');

class FakeRenderer implements RendererLike {
  async renderHtmlToJpg(html: string): Promise<Buffer> { return Buffer.from(html); }
}
class FixedFetcher implements Fetcher {
  constructor(private outcome: FetchOutcome) {}
  async fetch(): Promise<FetchOutcome> { return this.outcome; }
}

let dir: string;
let registry: PluginRegistry;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stv-logs-'));
  registry = new PluginRegistry();
  for (const p of await loadPluginsFrom(pluginsDir)) registry.register(p);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeEngine(outcome: FetchOutcome) {
  const store = ConfigStore.load(join(dir, 'config.json'));
  store.upsertDashboard({
    id: 'prom', pluginId: 'prometheus', name: 'Prom',
    config: { baseUrl: 'http://prometheus:9090', query: 'up', rangeSeconds: 3600, step: 60, label: 'CPU' },
    displayDurationMs: 15_000,
  });
  store.upsertDevice({ id: 'd', name: 'D', pollIntervalMs: 5000, assignments: [{ dashboardId: 'prom', displayDurationMs: 15_000 }] });
  const clock = new FakeClock(0);
  const engine = new Engine({
    store, registry, dataCache: new DataCache(new FixedFetcher(outcome), clock),
    renderer: new FakeRenderer(), imageCache: new ImageCache(clock), secrets: new SecretStore(undefined), clock,
  });
  return { engine, store };
}

describe('engine logging', () => {
  it('logs a datasource failure and the plugin explains the "no data"', async () => {
    const { engine } = makeEngine({ ok: false, error: 'fetch failed (ECONNREFUSED 10.0.0.5:9090)' });
    await engine.tick();
    await engine.getScreenForDevice('d');

    const logs = engine.logs.list({ dashboardId: 'prom' });
    expect(logs.some((l) => l.source === 'datasource' && /Fetch failed/i.test(l.message) && /ECONNREFUSED/.test(l.message))).toBe(true);
    expect(logs.some((l) => l.source === 'plugin' && /fetch failed/i.test(l.message))).toBe(true);
  });

  it('plugin logs "matched no series" when Prometheus returns an empty result', async () => {
    const { engine } = makeEngine({ ok: true, value: { status: 'success', data: { result: [] } } });
    await engine.tick();
    await engine.getScreenForDevice('d');
    const logs = engine.logs.list({ dashboardId: 'prom' });
    expect(logs.some((l) => l.source === 'datasource' && /Fetched/i.test(l.message))).toBe(true);
    expect(logs.some((l) => l.source === 'plugin' && /matched no series/i.test(l.message))).toBe(true);
  });

  it('fetches data on demand when rendering a dashboard no device polls (preview/cold start)', async () => {
    const store = ConfigStore.load(join(dir, 'config.json'));
    store.upsertDashboard({
      id: 'orphan', pluginId: 'prometheus', name: 'Orphan',
      config: { baseUrl: 'http://prometheus:9090', query: 'up', label: 'CPU' }, displayDurationMs: 15_000,
    });
    // Deliberately NOT assigned to any device.
    const clock = new FakeClock(0);
    const engine = new Engine({
      store, registry,
      dataCache: new DataCache(new FixedFetcher({ ok: true, value: { status: 'success', data: { result: [{ values: [[0, '1'], [60, '2'], [120, '3']] }] } } }), clock),
      renderer: new FakeRenderer(), imageCache: new ImageCache(clock), secrets: new SecretStore(undefined), clock,
    });

    const jpg = await engine.renderDashboardNow('orphan');
    expect(jpg).not.toBeNull();
    expect(jpg!.toString()).toContain('<polyline'); // real graph, not a "no data" card
    const logs = engine.logs.list({ dashboardId: 'orphan' });
    expect(logs.some((l) => l.source === 'datasource' && /Fetched/.test(l.message))).toBe(true);
    expect(logs.some((l) => /not fetched yet/.test(JSON.stringify(l)))).toBe(false);
  });

  it('serves logs via GET /admin/logs filtered by dashboard', async () => {
    const { engine, store } = makeEngine({ ok: false, error: 'fetch failed (ECONNREFUSED 10.0.0.5:9090)' });
    await engine.tick();
    await engine.getScreenForDevice('d');
    const app = buildServer({ engine, store, registry });

    const res = await app.inject({ method: 'GET', url: '/admin/logs?dashboardId=prom&level=warn' });
    expect(res.statusCode).toBe(200);
    const entries = res.json() as Array<{ source: string; message: string; level: string }>;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.level === 'warn' || e.level === 'error')).toBe(true);
    expect(entries.some((e) => /ECONNREFUSED/.test(e.message))).toBe(true);
    await app.close();
  });

  it('clears logs via DELETE /admin/logs', async () => {
    const { engine, store } = makeEngine({ ok: false, error: 'fetch failed (ECONNREFUSED 10.0.0.5:9090)' });
    await engine.tick();
    await engine.getScreenForDevice('d');
    const app = buildServer({ engine, store, registry });

    expect((await app.inject({ method: 'GET', url: '/admin/logs' })).json().length).toBeGreaterThan(0);
    const del = await app.inject({ method: 'DELETE', url: '/admin/logs' });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ cleared: true });
    expect((await app.inject({ method: 'GET', url: '/admin/logs' })).json()).toEqual([]);
    await app.close();
  });
});
