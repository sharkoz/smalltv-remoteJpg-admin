import { describe, it, expect } from 'vitest';
import { manifest, render } from '../plugins/prometheus/index.js';
import { makeBricks } from '../src/plugins/brick.js';
import { resolveTemplate, SecretStore } from '../src/config/secrets.js';
import { DEFAULT_THEME } from '../src/theme/palette.js';
import type { DataResult, RenderContext } from '../src/plugins/types.js';

interface Captured { level: string; message: string; meta?: unknown }
function ctxWith(config: Record<string, unknown>, series: DataResult): { ctx: RenderContext; logs: Captured[] } {
  const data = { series };
  const logs: Captured[] = [];
  const mk = (level: string) => (message: string, meta?: unknown) => logs.push({ level, message, meta });
  const log = { debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') };
  return { ctx: { dashboardId: 'p', config, data, now: new Date(0), brick: makeBricks(data), theme: DEFAULT_THEME, log }, logs };
}

const matrix = {
  status: 'success',
  data: { resultType: 'matrix', result: [{ metric: { job: 'api' }, values: [[1000, '1'], [1060, '2'], [1120, '1.5']] }] },
};

describe('prometheus plugin render', () => {
  const config = { baseUrl: 'http://prom:9090', query: 'up', label: 'CPU', unit: '%', decimals: 1 };

  it('renders an SVG sparkline with the last value', async () => {
    const { ctx } = ctxWith(config, { ok: true, value: matrix, stale: false });
    const html = await render(ctx);
    expect(html).toContain('<svg');
    expect(html).toContain('<polyline');
    expect(html).toContain('1.5 %'); // last value with unit, 1 decimal
    expect(html).toContain('CPU');
  });

  it('logs why it shows no data when the query matched no series', async () => {
    const { ctx, logs } = ctxWith(config, { ok: true, value: { status: 'success', data: { result: [] } }, stale: false });
    const html = await render(ctx);
    expect(html).toContain('no data');
    expect(html).not.toContain('<polyline');
    const warn = logs.find((l) => l.level === 'warn');
    expect(warn?.message).toMatch(/matched no series/i);
  });

  it('logs the fetch error when the data source failed', async () => {
    const { ctx, logs } = ctxWith(config, { ok: false, stale: true, error: 'fetch failed (ECONNREFUSED 127.0.0.1:9090)' });
    const html = await render(ctx);
    expect(html).toContain('no data');
    const warn = logs.find((l) => l.level === 'warn');
    expect(warn?.message).toMatch(/fetch failed/i);
    expect(warn?.meta).toMatchObject({ error: expect.stringContaining('ECONNREFUSED') });
  });

  it('logs a Prometheus query error (status:error)', async () => {
    const { ctx, logs } = ctxWith(config, { ok: true, value: { status: 'error', errorType: 'bad_data', error: 'parse error' }, stale: false });
    const html = await render(ctx);
    expect(html).toContain('query error');
    expect(logs.find((l) => l.level === 'warn')?.message).toMatch(/rejected the query/i);
  });

  it('shows a stale marker when serving cached data', async () => {
    const { ctx } = ctxWith(config, { ok: true, value: matrix, stale: true });
    const html = await render(ctx);
    expect(html).toContain('#e0a000'); // stale dot color
  });
});

describe('prometheus data-source URL resolution', () => {
  it('builds a query_range URL with time window and url-encoded PromQL', () => {
    const url = manifest.dataSources![0]!.url;
    const resolved = resolveTemplate(url, {
      config: { baseUrl: 'http://prom:9090', query: 'rate(http_requests_total[5m])', rangeSeconds: 600, step: 30 },
      secrets: new SecretStore(undefined),
      nowMs: 1_000_000, // nowS = 1000
    });
    expect(resolved).toContain('http://prom:9090/api/v1/query_range');
    expect(resolved).toContain('query=rate(http_requests_total%5B5m%5D)'); // [ ] encoded
    expect(resolved).toContain('start=400'); // 1000 - 600
    expect(resolved).toContain('end=1000');
    expect(resolved).toContain('step=30');
  });
});
