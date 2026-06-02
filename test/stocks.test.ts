import { describe, it, expect } from 'vitest';
import { manifest, render } from '../plugins/stocks/index.js';
import { makeBricks } from '../src/plugins/brick.js';
import { resolveTemplate, SecretStore } from '../src/config/secrets.js';
import type { DataResult, RenderContext } from '../src/plugins/types.js';

interface Captured { level: string; message: string; meta?: unknown }
function ctxWith(config: Record<string, unknown>, chart: DataResult): { ctx: RenderContext; logs: Captured[] } {
  const data = { chart };
  const logs: Captured[] = [];
  const mk = (level: string) => (message: string, meta?: unknown) => logs.push({ level, message, meta });
  const log = { debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') };
  return { ctx: { dashboardId: 'stocks', config, data, now: new Date(0), brick: makeBricks(data), log }, logs };
}

const yahooChart = {
  chart: {
    result: [{
      meta: { currency: 'USD', regularMarketPrice: 105, chartPreviousClose: 100 },
      timestamp: [1, 2, 3],
      indicators: { quote: [{ close: [100, 102, 105] }] },
    }],
    error: null,
  },
};

describe('stocks plugin render', () => {
  const config = { symbol: 'BTC-USD', assetType: 'crypto', label: 'Bitcoin', rangeDays: 30, interval: '1d', color: '#f7931a', decimals: 0 };

  it('renders current price, delta, and sparkline', async () => {
    const { ctx } = ctxWith(config, { ok: true, value: yahooChart, stale: false });
    const html = await render(ctx);
    expect(html).toContain('Bitcoin');
    expect(html).toContain('105 USD');
    expect(html).toContain('+5.00%');
    expect(html).toContain('<svg');
    expect(html).toContain('<polyline');
  });

  it('logs a useful warning when the data source failed', async () => {
    const { ctx, logs } = ctxWith(config, { ok: false, stale: true, error: 'network down' });
    const html = await render(ctx);
    expect(html).toContain('no data');
    expect(logs.find((l) => l.level === 'warn')?.message).toMatch(/fetch failed/i);
  });
});

describe('stocks data-source URL resolution', () => {
  it('builds a Yahoo Finance chart URL for stock or crypto symbols', () => {
    const resolved = resolveTemplate(manifest.dataSources![0]!.url, {
      config: { symbol: 'BTC-USD', rangeDays: 7, interval: '1h' },
      secrets: new SecretStore(undefined),
      nowMs: 1_000_000,
    });
    expect(resolved).toBe('https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?range=7d&interval=1h');
  });
});
