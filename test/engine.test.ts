import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/app/engine.js';
import { ConfigStore } from '../src/config/store.js';
import { PluginRegistry } from '../src/plugins/registry.js';
import { loadPluginsFrom } from '../src/plugins/loader.js';
import { DataCache } from '../src/datasource/cache.js';
import { ImageCache } from '../src/render/imageCache.js';
import { SecretStore } from '../src/config/secrets.js';
import { FakeClock } from '../src/util/time.js';
import type { RendererLike } from '../src/render/renderer.js';
import type { Fetcher, FetchOutcome, FetchRequest } from '../src/datasource/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = join(here, '..', 'plugins');

class FakeRenderer implements RendererLike {
  public renders: string[] = [];
  async renderHtmlToJpg(html: string): Promise<Buffer> {
    this.renders.push(html);
    return Buffer.from(html);
  }
}

class ScriptedFetcher implements Fetcher {
  public calls: FetchRequest[] = [];
  constructor(private script: FetchOutcome[]) {}
  async fetch(req: FetchRequest): Promise<FetchOutcome> {
    this.calls.push(req);
    return this.script.shift() ?? { ok: false, error: 'no more responses' };
  }
}

let dir: string;
let registry: PluginRegistry;

async function getRegistry(): Promise<PluginRegistry> {
  const reg = new PluginRegistry();
  for (const p of await loadPluginsFrom(pluginsDir)) reg.register(p);
  return reg;
}

function makeEngine(outcomes: FetchOutcome[]) {
  const store = ConfigStore.load(join(dir, 'config.json'));
  store.upsertDashboard({
    id: 'clock-paris', pluginId: 'clock', name: 'Paris',
    config: { timezone: 'Europe/Paris', label: 'PARIS' }, displayDurationMs: 10_000,
  });
  store.upsertDashboard({
    id: 'clock-tokyo', pluginId: 'clock', name: 'Tokyo',
    config: { timezone: 'Asia/Tokyo', label: 'TOKYO' }, displayDurationMs: 10_000,
  });
  store.upsertDashboard({
    id: 'fx', pluginId: 'api-value', name: 'FX',
    config: { url: 'https://example.com/fx', jsonPath: 'rates.EUR', label: 'EUR' }, displayDurationMs: 15_000,
  });
  store.upsertDevice({
    id: 'kitchen', name: 'Kitchen', pollIntervalMs: 2000,
    assignments: [
      { dashboardId: 'clock-paris', displayDurationMs: 10_000 },
      { dashboardId: 'clock-tokyo', displayDurationMs: 10_000 },
    ],
  });
  store.upsertDevice({
    id: 'fxdev', name: 'FX Device', pollIntervalMs: 2000,
    assignments: [{ dashboardId: 'fx', displayDurationMs: 15_000 }],
  });

  const clock = new FakeClock(0);
  const fetcher = new ScriptedFetcher(outcomes);
  const dataCache = new DataCache(fetcher, clock);
  const imageCache = new ImageCache(clock);
  const renderer = new FakeRenderer();
  const engine = new Engine({
    store, registry, dataCache, renderer, imageCache, secrets: new SecretStore(undefined), clock,
  });
  return { engine, clock, renderer, dataCache, store, imageCache, fetcher };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stv-engine-'));
  registry = await getRegistry();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Engine.getScreenForDevice (rotation + cold render)', () => {
  it('renders the current dashboard on a cold cache', async () => {
    const { engine } = makeEngine([]);
    const res = await engine.getScreenForDevice('kitchen');
    expect(res?.dashboardId).toBe('clock-paris');
    expect(res!.jpg.toString()).toContain('PARIS');
  });

  it('advances to the next dashboard as the clock crosses the slot boundary', async () => {
    const { engine, clock } = makeEngine([]);
    expect((await engine.getScreenForDevice('kitchen'))?.dashboardId).toBe('clock-paris');
    clock.advance(11_000);
    const res = await engine.getScreenForDevice('kitchen');
    expect(res?.dashboardId).toBe('clock-tokyo');
    expect(res!.jpg.toString()).toContain('TOKYO');
  });

  it('returns a placeholder for an unknown device', async () => {
    const { engine } = makeEngine([]);
    expect(await engine.getScreenForDevice('nope')).toBeNull();
  });
});

describe('Engine data integration', () => {
  it('renders a fetched value after a tick', async () => {
    const { engine } = makeEngine([{ ok: true, value: { rates: { EUR: 0.92 } } }]);
    await engine.tick(); // fetch + pre-render
    const res = await engine.getScreenForDevice('fxdev');
    expect(res!.jpg.toString()).toContain('0.92');
  });

  it('degrades gracefully when the data source fails (still a valid render with fallback)', async () => {
    const { engine } = makeEngine([{ ok: false, error: 'HTTP 500' }]);
    await engine.tick();
    const res = await engine.getScreenForDevice('fxdev');
    // Fallback marker rendered instead of crashing.
    expect(res!.jpg.toString()).toContain('—');
  });

  it('keeps showing the last good value (stale) after a later failure', async () => {
    const { engine, clock, dataCache } = makeEngine([
      { ok: true, value: { rates: { EUR: 0.91 } } },
      { ok: false, error: 'HTTP 500' },
    ]);
    await engine.tick(); // good
    clock.advance(61_000); // make the source due again
    await dataCache.refresh('fx', { id: 'main', url: 'https://example.com/fx', refreshIntervalMs: 60_000 }, (s) => s);
    const res = await engine.getScreenForDevice('fxdev');
    expect(res!.jpg.toString()).toContain('0.91');
  });

  it('refetches immediately when a dashboard config changes the resolved source URL', async () => {
    const { engine, store, fetcher } = makeEngine([
      { ok: true, value: { rates: { EUR: 0.91 } } },
      { ok: true, value: { rates: { EUR: 0.93 } } },
    ]);
    const first = await engine.renderDashboardNow('fx');
    expect(first!.toString()).toContain('0.91');

    store.upsertDashboard({
      id: 'fx', pluginId: 'api-value', name: 'FX',
      config: { url: 'https://example.com/fx-new', jsonPath: 'rates.EUR', label: 'EUR' }, displayDurationMs: 15_000,
    });

    const second = await engine.renderDashboardNow('fx');
    expect(second!.toString()).toContain('0.93');
    expect(fetcher.calls.map((c) => c.url)).toEqual(['https://example.com/fx', 'https://example.com/fx-new']);
  });
});

describe('Engine.tick re-rendering', () => {
  it('re-renders a clock dashboard once its rerender interval elapses', async () => {
    const { engine, clock, renderer } = makeEngine([]);
    await engine.tick();
    const after1 = renderer.renders.length;
    clock.advance(300); // < rerenderIntervalMs (1000)
    await engine.tick();
    expect(renderer.renders.length).toBe(after1);
    clock.advance(1200); // now past 1000ms
    await engine.tick();
    expect(renderer.renders.length).toBeGreaterThan(after1);
  });
});
