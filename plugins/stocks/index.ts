import { z } from 'zod';
import type { PluginManifest, RenderContext, RenderFn } from '../../src/plugins/types.js';
import { esc } from '../../src/plugins/brick.js';

const configSchema = z.object({
  /** Yahoo Finance symbol, e.g. AAPL, MC.PA, BTC-USD, ETH-USD. */
  symbol: z.string().min(1).default('BTC-USD'),
  /** Stock or crypto only changes labels/default styling; Yahoo handles both through the same endpoint. */
  assetType: z.enum(['stock', 'crypto']).default('crypto'),
  /** Optional title. Empty = symbol. */
  label: z.string().default(''),
  /** Optional logo URL. If empty, a monogram logo is rendered. */
  logoUrl: z.string().url().or(z.literal('')).default(''),
  /** Number of days shown in the sparkline. */
  rangeDays: z.number().int().positive().max(365).default(30),
  /** Yahoo chart sampling interval. */
  interval: z.enum(['5m', '15m', '1h', '1d']).default('1d'),
  /** Line color (hex). */
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).default('#36d399'),
  decimals: z.number().int().min(0).max(6).default(2),
});

export const manifest: PluginManifest = {
  id: 'stocks',
  name: 'Stocks / Crypto',
  defaultDisplayDurationMs: 15_000,
  dataSources: [
    {
      id: 'chart',
      url: 'https://query1.finance.yahoo.com/v8/finance/chart/{{config.symbol|url}}?range={{config.rangeDays}}d&interval={{config.interval}}',
      method: 'GET',
      refreshIntervalMs: 15 * 60_000,
      responseType: 'json',
    },
  ],
  rerenderIntervalMs: 15 * 60_000,
  configSchema,
  configFields: [
    { key: 'assetType', label: 'Asset type', type: 'select', default: 'crypto', options: [{ value: 'stock', label: 'Stock' }, { value: 'crypto', label: 'Crypto' }], description: 'Only used for presentation. The symbol is fetched from Yahoo Finance.' },
    { key: 'symbol', label: 'Symbol', type: 'string', default: 'BTC-USD', required: true, placeholder: 'AAPL, MC.PA, BTC-USD', description: 'Yahoo Finance symbol. Crypto pairs usually use COIN-CURRENCY, e.g. BTC-USD.' },
    { key: 'label', label: 'Title', type: 'string', default: '', placeholder: 'Bitcoin, Apple, LVMH', description: 'Optional title; empty uses the symbol.' },
    { key: 'logoUrl', label: 'Logo URL', type: 'string', default: '', placeholder: 'https://...', description: 'Optional currency/company logo. If empty, a symbol monogram is shown.' },
    { key: 'rangeDays', label: 'Chart window (days)', type: 'number', default: 30, min: 1, max: 365, step: 1, description: 'Number of days displayed in the curve.' },
    { key: 'interval', label: 'Chart interval', type: 'select', default: '1d', options: [{ value: '5m', label: '5 min' }, { value: '15m', label: '15 min' }, { value: '1h', label: '1 hour' }, { value: '1d', label: '1 day' }] },
    { key: 'color', label: 'Line color', type: 'color', default: '#36d399' },
    { key: 'decimals', label: 'Decimals', type: 'number', default: 2, min: 0, max: 6 },
  ],
  exampleConfig: {
    assetType: 'crypto',
    symbol: 'BTC-USD',
    label: 'Bitcoin',
    logoUrl: 'https://cryptologos.cc/logos/bitcoin-btc-logo.svg?v=040',
    rangeDays: 30,
    interval: '1d',
    color: '#f7931a',
    decimals: 0,
  },
};

interface YahooChartResponse {
  chart?: {
    error?: { code?: string; description?: string } | null;
    result?: Array<{
      meta?: {
        currency?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

function compactSymbol(symbol: string): string {
  return symbol.replace(/[-.=].*$/, '').slice(0, 4).toUpperCase();
}

function formatPrice(value: number, currency: string | undefined, decimals: number): string {
  const formatted = value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency ? `${formatted} ${currency}` : formatted;
}

function extractChart(value: unknown) {
  const raw = value as YahooChartResponse;
  const result = raw.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points = closes.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const last = points[points.length - 1] ?? result?.meta?.regularMarketPrice;
  const previous = result?.meta?.chartPreviousClose ?? result?.meta?.previousClose ?? points[0];
  const currency = result?.meta?.currency;
  return { error: raw.chart?.error, points, last, previous, currency };
}

function logoHtml(cfg: z.infer<typeof configSchema>, textColor: string): string {
  const label = esc(cfg.label || cfg.symbol);
  if (cfg.logoUrl) {
    return `<img src="${esc(cfg.logoUrl)}" alt="${label}" style="width:38px;height:38px;border-radius:50%;object-fit:contain;background:#fff;padding:3px">`;
  }
  return `<div style="width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${esc(cfg.color)};color:${esc(textColor)};font-weight:800;font-size:13px;letter-spacing:.2px">${esc(compactSymbol(cfg.symbol))}</div>`;
}

/** Build an SVG sparkline with fill. */
function sparkline(points: number[], color: string): string {
  const W = 216, H = 82, P = 5;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = points.length > 1 ? (W - 2 * P) / (points.length - 1) : 0;
  const coords = points.map((v, i) => {
    const x = P + i * stepX;
    const y = P + (H - 2 * P) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polyline points="${line}" fill="none" stroke="${esc(color)}" stroke-width="2.3" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

export const render: RenderFn = (ctx: RenderContext) => {
  const cfg = configSchema.parse(ctx.config);
  const theme = ctx.theme;
  const source = ctx.data.chart;
  const title = cfg.label || cfg.symbol;

  const shell = (body: string) => ctx.brick.screen(body, { bg: theme.bg, color: theme.text, padding: 7, font: theme.font });
  const noData = (caption: string) => shell(`
    <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center">
      ${logoHtml(cfg, theme.bg)}
      <div style="font-size:17px;color:${esc(theme.text)};font-weight:700">${esc(title)}</div>
      <div style="font-size:22px;color:${esc(theme.muted)};font-weight:700">${esc(caption)}</div>
    </div>`);

  if (!source || !source.ok) {
    ctx.log.warn('Market chart fetch failed', { symbol: cfg.symbol, error: source?.error });
    return noData('no data');
  }

  const chart = extractChart(source.value);
  if (chart.error) {
    ctx.log.warn('Yahoo Finance rejected the chart request', { symbol: cfg.symbol, error: chart.error });
    return noData('symbol error');
  }
  if (!Number.isFinite(chart.last) || chart.points.length === 0) {
    ctx.log.warn('Market response has no numeric prices', { symbol: cfg.symbol, rangeDays: cfg.rangeDays, interval: cfg.interval });
    return noData('no prices');
  }

  const last = chart.last!;
  const previous = Number.isFinite(chart.previous) ? chart.previous! : last;
  const deltaPct = previous === 0 ? 0 : ((last - previous) / previous) * 100;
  const up = deltaPct >= 0;
  const accent = up ? cfg.color : theme.bad;
  const price = formatPrice(last, chart.currency, cfg.decimals);
  const delta = `${up ? '+' : ''}${deltaPct.toFixed(2)}%`;
  const staleDot = source.stale ? `<div style="position:absolute;top:7px;right:7px;width:7px;height:7px;border-radius:50%;background:${esc(theme.warn)}"></div>` : '';

  return shell(`
    <div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;gap:7px">
      ${staleDot}
      <div style="display:flex;align-items:center;gap:9px;min-height:42px">
        ${logoHtml(cfg, theme.bg)}
        <div style="min-width:0;flex:1">
          <div style="font-size:15px;line-height:1.1;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</div>
          <div style="font-size:10px;color:${esc(theme.muted)};text-transform:uppercase;letter-spacing:.7px">${esc(cfg.assetType)} · ${esc(cfg.symbol)} · ${cfg.rangeDays}d</div>
        </div>
      </div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px">
        <div style="font-size:29px;line-height:1;font-weight:850;letter-spacing:-1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(price)}</div>
        <div style="font-size:14px;font-weight:800;color:${esc(accent)};padding-bottom:1px">${esc(delta)}</div>
      </div>
      <div style="margin-top:2px;border:1px solid ${esc(theme.border)};border-radius:12px;background:${esc(theme.surface)};padding:5px">
        ${sparkline(chart.points, accent)}
      </div>
      <div style="display:flex;justify-content:space-between;color:${esc(theme.muted)};font-size:10px;letter-spacing:.2px">
        <span>${cfg.rangeDays} days</span><span>${esc(cfg.interval)}</span>
      </div>
    </div>`);
};
