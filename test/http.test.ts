import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { ImageCache } from '../src/render/imageCache.js';
import { SecretStore } from '../src/config/secrets.js';
import { FakeClock } from '../src/util/time.js';
import type { RendererLike } from '../src/render/renderer.js';
import type { Fetcher, FetchOutcome } from '../src/datasource/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = join(here, '..', 'plugins');

class FakeRenderer implements RendererLike {
  async renderHtmlToJpg(html: string): Promise<Buffer> {
    return Buffer.from(html);
  }
}
class NullFetcher implements Fetcher {
  async fetch(): Promise<FetchOutcome> {
    return { ok: false, error: 'offline' };
  }
}

let dir: string;
let app: FastifyInstance;
let store: ConfigStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stv-http-'));
  store = ConfigStore.load(join(dir, 'config.json'));
  store.upsertDashboard({
    id: 'clock-paris', pluginId: 'clock', name: 'Paris',
    config: { timezone: 'Europe/Paris', label: 'PARIS' }, displayDurationMs: 10_000,
  });
  store.upsertDevice({
    id: 'kitchen', name: 'Kitchen', pollIntervalMs: 2000,
    assignments: [{ dashboardId: 'clock-paris', displayDurationMs: 10_000 }],
  });

  const registry = new PluginRegistry();
  for (const p of await loadPluginsFrom(pluginsDir)) registry.register(p);

  const clock = new FakeClock(0);
  const engine = new Engine({
    store, registry,
    dataCache: new DataCache(new NullFetcher(), clock),
    renderer: new FakeRenderer(),
    imageCache: new ImageCache(clock),
    secrets: new SecretStore(undefined),
    clock,
  });
  app = buildServer({ engine, store, registry });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('HTTP routes', () => {
  it('GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /devices/:id/screen.jpg returns a JPEG with the current dashboard header', async () => {
    const res = await app.inject({ method: 'GET', url: '/devices/kitchen/screen.jpg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['x-dashboard-id']).toBe('clock-paris');
    expect(res.rawPayload.toString()).toContain('PARIS');
  });

  it('GET /devices/:id/screen.jpg 404 for unknown device', async () => {
    const res = await app.inject({ method: 'GET', url: '/devices/nope/screen.jpg' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /admin/plugins lists built-in plugins with example configs', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/plugins' });
    const plugins = res.json() as Array<{ id: string; exampleConfig: Record<string, unknown> }>;
    const ids = plugins.map((p) => p.id).sort();

    expect(ids).toEqual(['ai-usage', 'api-value', 'clock', 'prometheus', 'stocks']);

    const clock = plugins.find((p) => p.id === 'clock')!;
    expect(clock.exampleConfig).toMatchObject({ timezone: 'Europe/Paris' });
  });

  it('GET /admin/config exposes available themes and the technical fallback', async () => {
    const before = await app.inject({ method: 'GET', url: '/admin/config' });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ defaultTheme: 'dark', themes: ['dark', 'black', 'light', 'terminal'] });
  });

  it('POST /admin/dashboards validates config and persists', async () => {
    const ok = await app.inject({
      method: 'POST', url: '/admin/dashboards',
      payload: { id: 'fx', pluginId: 'api-value', name: 'FX', config: { url: 'https://example.com/x' }, displayDurationMs: 15000 },
    });
    expect(ok.statusCode).toBe(201);
    expect(store.getDashboard('fx')).toBeDefined();
  });

  it('updates device slot durations that still use a dashboard default', async () => {
    const ok = await app.inject({
      method: 'POST', url: '/admin/dashboards',
      payload: { id: 'clock-paris', pluginId: 'clock', name: 'Paris', config: { timezone: 'Europe/Paris', label: 'PARIS' }, displayDurationMs: 3000 },
    });
    expect(ok.statusCode).toBe(201);
    expect(store.getDevice('kitchen')!.assignments[0]!.displayDurationMs).toBe(3000);
  });

  it('does not overwrite device slot duration overrides when dashboard duration changes', async () => {
    store.upsertDevice({
      id: 'custom', name: 'Custom', pollIntervalMs: 2000,
      assignments: [{ dashboardId: 'clock-paris', displayDurationMs: 7000 }],
    });
    const ok = await app.inject({
      method: 'POST', url: '/admin/dashboards',
      payload: { id: 'clock-paris', pluginId: 'clock', name: 'Paris', config: { timezone: 'Europe/Paris', label: 'PARIS' }, displayDurationMs: 3000 },
    });
    expect(ok.statusCode).toBe(201);
    expect(store.getDevice('custom')!.assignments[0]!.displayDurationMs).toBe(7000);
  });

  it('generates a hidden slug id when none is provided, and de-duplicates', async () => {
    const a = await app.inject({
      method: 'POST', url: '/admin/dashboards',
      payload: { pluginId: 'clock', name: 'My Cool Clock', config: {}, displayDurationMs: 10000 },
    });
    expect(a.statusCode).toBe(201);
    expect(a.json().dashboard.id).toBe('my-cool-clock');

    const b = await app.inject({
      method: 'POST', url: '/admin/dashboards',
      payload: { pluginId: 'clock', name: 'My Cool Clock', config: {}, displayDurationMs: 10000 },
    });
    expect(b.json().dashboard.id).toBe('my-cool-clock-2');
  });

  it('POST /admin/dashboards rejects unknown plugin and invalid config', async () => {
    const badPlugin = await app.inject({
      method: 'POST', url: '/admin/dashboards',
      payload: { id: 'x', pluginId: 'ghost', name: 'X', config: {}, displayDurationMs: 1000 },
    });
    expect(badPlugin.statusCode).toBe(400);

    const badConfig = await app.inject({
      method: 'POST', url: '/admin/dashboards',
      payload: { id: 'y', pluginId: 'api-value', name: 'Y', config: { url: 'not-a-url' }, displayDurationMs: 1000 },
    });
    expect(badConfig.statusCode).toBe(400);
  });

  it('POST /admin/devices rejects references to unknown dashboards and warns on short slots', async () => {
    const unknown = await app.inject({
      method: 'POST', url: '/admin/devices',
      payload: { id: 'd2', name: 'D2', pollIntervalMs: 5000, assignments: [{ dashboardId: 'ghost', displayDurationMs: 10000 }] },
    });
    expect(unknown.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST', url: '/admin/devices',
      payload: { id: 'd3', name: 'D3', pollIntervalMs: 5000, assignments: [{ dashboardId: 'clock-paris', displayDurationMs: 1000 }] },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().warnings).toHaveLength(1); // 1000ms slot < 5000ms poll interval
  });

  it('POST /admin/devices accepts a theme override', async () => {
    const ok = await app.inject({
      method: 'POST', url: '/admin/devices',
      payload: { id: 'themed', name: 'Themed', theme: 'terminal', pollIntervalMs: 5000, assignments: [{ dashboardId: 'clock-paris', displayDurationMs: 10000 }] },
    });
    expect(ok.statusCode).toBe(201);
    expect(store.getDevice('themed')!.theme).toBe('terminal');
  });

  it('DELETE /admin/devices/:id reports removal', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/admin/devices/kitchen' })).json()).toEqual({ removed: true });
    expect((await app.inject({ method: 'DELETE', url: '/admin/devices/kitchen' })).statusCode).toBe(404);
  });

  it('GET /admin/dashboards/:id/preview.jpg renders one dashboard, 404 for unknown', async () => {
    const ok = await app.inject({ method: 'GET', url: '/admin/dashboards/clock-paris/preview.jpg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('image/jpeg');

    const missing = await app.inject({ method: 'GET', url: '/admin/dashboards/ghost/preview.jpg' });
    expect(missing.statusCode).toBe(404);
  });
});
