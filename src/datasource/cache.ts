import type { DataSourceDecl, DataResult } from '../plugins/types.js';
import type { Fetcher, FetchRequest } from './types.js';
import type { Clock } from '../util/time.js';
import { systemClock } from '../util/time.js';

interface Entry {
  result: DataResult;
  refreshIntervalMs: number;
  requestKey: string;
}

/** A string template resolver bound to one dashboard's config + secrets. */
export type Resolver = (template: string) => string;

/**
 * Caches resolved data per (dashboard, source). Pure with respect to time: it
 * never schedules anything itself — a scheduler calls `refresh`, and `snapshot`
 * reads the current value computing staleness from the injected clock. On a
 * failed fetch it keeps the last good value but flags it stale, so renders
 * degrade gracefully instead of going blank.
 */
export class DataCache {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly fetcher: Fetcher,
    private readonly clock: Clock = systemClock,
  ) {}

  private key(dashboardId: string, sourceId: string): string {
    return `${dashboardId}::${sourceId}`;
  }

  private requestFor(decl: DataSourceDecl, resolve: Resolver): FetchRequest {
    const headers = decl.headers
      ? Object.fromEntries(Object.entries(decl.headers).map(([k, v]) => [k, resolve(v)]))
      : undefined;
    return {
      url: resolve(decl.url),
      headers,
      timeoutMs: decl.timeoutMs,
      responseType: decl.responseType ?? 'json',
    };
  }

  private requestKey(req: FetchRequest): string {
    return JSON.stringify(req);
  }

  /** True when the cached value was fetched with the same resolved request. */
  matchesRequest(dashboardId: string, decl: DataSourceDecl, resolve: Resolver): boolean {
    const entry = this.entries.get(this.key(dashboardId, decl.id));
    return Boolean(entry && entry.requestKey === this.requestKey(this.requestFor(decl, resolve)));
  }

  /** Fetch a source for a dashboard and store the outcome. Never throws.
   * Returns true if the stored value changed (used to invalidate rendered images). */
  async refresh(dashboardId: string, decl: DataSourceDecl, resolve: Resolver): Promise<boolean> {
    const key = this.key(dashboardId, decl.id);
    const prev = this.entries.get(key)?.result;
    const req = this.requestFor(decl, resolve);
    const requestKey = this.requestKey(req);
    const outcome = await this.fetcher.fetch(req);

    if (outcome.ok) {
      const changed = JSON.stringify(prev?.value) !== JSON.stringify(outcome.value);
      this.entries.set(key, {
        result: { ok: true, value: outcome.value, stale: false, fetchedAt: this.clock.nowMs() },
        refreshIntervalMs: decl.refreshIntervalMs,
        requestKey,
      });
      return changed;
    }

    // Failure: keep the last good value (if any) but mark stale and attach the error.
    const hadGoodValue = prev?.ok && prev.value !== undefined;
    const wasAlreadyStale = prev?.stale === true;
    this.entries.set(key, {
      result: {
        ok: Boolean(hadGoodValue),
        value: hadGoodValue ? prev!.value : undefined,
        error: outcome.error,
        stale: true,
        fetchedAt: prev?.fetchedAt,
      },
      refreshIntervalMs: decl.refreshIntervalMs,
      requestKey,
    });
    // The visible value didn't change, but a fresh failure should surface the
    // stale marker once (re-render the first time it goes stale).
    return !wasAlreadyStale;
  }

  /** Current value for a source, marking it stale if overdue past its refresh interval. */
  snapshot(dashboardId: string, sourceId: string): DataResult {
    const entry = this.entries.get(this.key(dashboardId, sourceId));
    if (!entry) {
      return { ok: false, stale: true, error: 'not fetched yet' };
    }
    const { result, refreshIntervalMs } = entry;
    const overdue =
      result.fetchedAt != null && this.clock.nowMs() - result.fetchedAt > refreshIntervalMs;
    return { ...result, stale: result.stale || overdue };
  }

  /** Build the `data` map a render needs from a plugin's declared sources. */
  snapshotAll(dashboardId: string, decls: DataSourceDecl[] | undefined): Record<string, DataResult> {
    const out: Record<string, DataResult> = {};
    for (const decl of decls ?? []) {
      out[decl.id] = this.snapshot(dashboardId, decl.id);
    }
    return out;
  }

  /** Drop all cached entries for a dashboard (e.g. when it's deleted). */
  evictDashboard(dashboardId: string): void {
    const prefix = `${dashboardId}::`;
    for (const k of this.entries.keys()) {
      if (k.startsWith(prefix)) this.entries.delete(k);
    }
  }
}
