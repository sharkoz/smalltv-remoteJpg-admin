import { describe, it, expect } from 'vitest';
import { DataCache } from '../src/datasource/cache.js';
import type { Fetcher, FetchRequest, FetchOutcome } from '../src/datasource/types.js';
import type { DataSourceDecl } from '../src/plugins/types.js';
import { FakeClock } from '../src/util/time.js';

/** A fetcher whose responses are scripted per call. */
class ScriptedFetcher implements Fetcher {
  public calls: FetchRequest[] = [];
  constructor(private script: FetchOutcome[]) {}
  async fetch(req: FetchRequest): Promise<FetchOutcome> {
    this.calls.push(req);
    return this.script.shift() ?? { ok: false, error: 'no more scripted responses' };
  }
}

const decl: DataSourceDecl = {
  id: 'main',
  url: 'https://api/{{config.path}}',
  headers: { Authorization: 'Bearer {{secret.key}}' },
  refreshIntervalMs: 1000,
  responseType: 'json',
};

const resolver = (s: string) =>
  s.replace('{{config.path}}', 'btc').replace('{{secret.key}}', 'topsecret');

describe('DataCache', () => {
  it('reports not-fetched before any refresh', () => {
    const cache = new DataCache(new ScriptedFetcher([]), new FakeClock(0));
    const snap = cache.snapshot('d1', 'main');
    expect(snap).toMatchObject({ ok: false, stale: true });
  });

  it('resolves config and secret placeholders in url and headers', async () => {
    const fetcher = new ScriptedFetcher([{ ok: true, value: { price: 42 } }]);
    const cache = new DataCache(fetcher, new FakeClock(0));
    await cache.refresh('d1', decl, resolver);
    expect(fetcher.calls[0]!.url).toBe('https://api/btc');
    expect(fetcher.calls[0]!.headers).toEqual({ Authorization: 'Bearer topsecret' });
  });

  it('stores a fresh value on success', async () => {
    const cache = new DataCache(new ScriptedFetcher([{ ok: true, value: { price: 42 } }]), new FakeClock(0));
    await cache.refresh('d1', decl, resolver);
    expect(cache.snapshot('d1', 'main')).toMatchObject({ ok: true, value: { price: 42 }, stale: false });
  });

  it('detects when the resolved request changed', async () => {
    const cache = new DataCache(new ScriptedFetcher([{ ok: true, value: { price: 42 } }]), new FakeClock(0));
    await cache.refresh('d1', decl, resolver);
    expect(cache.matchesRequest('d1', decl, resolver)).toBe(true);
    expect(cache.matchesRequest('d1', decl, (s) => s.replace('{{config.path}}', 'eth').replace('{{secret.key}}', 'topsecret'))).toBe(false);
  });

  it('marks a value stale once it is overdue past the refresh interval', async () => {
    const clock = new FakeClock(0);
    const cache = new DataCache(new ScriptedFetcher([{ ok: true, value: 1 }]), clock);
    await cache.refresh('d1', decl, resolver);
    expect(cache.snapshot('d1', 'main').stale).toBe(false);
    clock.advance(1500); // > refreshIntervalMs (1000)
    expect(cache.snapshot('d1', 'main').stale).toBe(true);
  });

  it('keeps the last good value but flags stale when a later fetch fails', async () => {
    const clock = new FakeClock(0);
    const cache = new DataCache(
      new ScriptedFetcher([
        { ok: true, value: { price: 100 } },
        { ok: false, error: 'HTTP 500' },
      ]),
      clock,
    );
    await cache.refresh('d1', decl, resolver); // good
    await cache.refresh('d1', decl, resolver); // fails
    const snap = cache.snapshot('d1', 'main');
    expect(snap).toMatchObject({ ok: true, value: { price: 100 }, stale: true, error: 'HTTP 500' });
  });

  it('reports ok:false when the very first fetch fails', async () => {
    const cache = new DataCache(new ScriptedFetcher([{ ok: false, error: 'HTTP 500' }]), new FakeClock(0));
    await cache.refresh('d1', decl, resolver);
    expect(cache.snapshot('d1', 'main')).toMatchObject({ ok: false, stale: true, error: 'HTTP 500' });
  });

  it('snapshotAll builds a keyed map for a plugin declared sources', async () => {
    const cache = new DataCache(new ScriptedFetcher([{ ok: true, value: 7 }]), new FakeClock(0));
    await cache.refresh('d1', decl, resolver);
    expect(cache.snapshotAll('d1', [decl])).toEqual({ main: expect.objectContaining({ ok: true, value: 7 }) });
  });

  it('evicts all entries for a dashboard', async () => {
    const cache = new DataCache(new ScriptedFetcher([{ ok: true, value: 1 }]), new FakeClock(0));
    await cache.refresh('d1', decl, resolver);
    cache.evictDashboard('d1');
    expect(cache.snapshot('d1', 'main')).toMatchObject({ ok: false, error: 'not fetched yet' });
  });
});
