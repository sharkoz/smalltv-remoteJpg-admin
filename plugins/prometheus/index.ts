import { z } from 'zod';
import type { PluginManifest, RenderFn, RenderContext } from '../../src/plugins/types.js';

const configSchema = z.object({
  /** Base URL of the Prometheus server, e.g. http://prometheus:9090 */
  baseUrl: z.string().url(),
  /** PromQL expression to graph (URL-encoded automatically). */
  query: z.string().min(1),
  /** Time window in seconds (the graph spans now-rangeSeconds .. now). */
  rangeSeconds: z.number().int().positive().default(3600),
  /** Resolution in seconds between points. */
  step: z.number().int().positive().default(60),
  label: z.string().default(''),
  unit: z.string().default(''),
  /** Line color (hex). */
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).default('#4f9eff'),
  decimals: z.number().int().min(0).max(6).default(2),
});

export const manifest: PluginManifest = {
  id: 'prometheus',
  name: 'Prometheus Graph',
  defaultDisplayDurationMs: 15_000,
  dataSources: [
    {
      id: 'series',
      // time.rangeStart = now - config.rangeSeconds ; query is percent-encoded via |url.
      url: '{{config.baseUrl}}/api/v1/query_range?query={{config.query|url}}&start={{time.rangeStart}}&end={{time.now}}&step={{config.step}}',
      method: 'GET',
      refreshIntervalMs: 30_000,
      responseType: 'json',
    },
  ],
  rerenderIntervalMs: 30_000,
  configSchema,
  configFields: [
    { key: 'baseUrl', label: 'Prometheus URL', type: 'string', required: true, placeholder: 'http://prometheus:9090', description: 'Base URL of your Prometheus server (reachable from this server).' },
    { key: 'query', label: 'PromQL query', type: 'text', required: true, placeholder: 'rate(node_cpu_seconds_total[5m])', description: 'The expression to graph. Tip: wrap counters in rate().' },
    { key: 'rangeSeconds', label: 'Time window (seconds)', type: 'number', default: 3600, min: 60, step: 60, description: 'How far back the graph spans.' },
    { key: 'step', label: 'Step (seconds)', type: 'number', default: 60, min: 1, description: 'Resolution between points.' },
    { key: 'label', label: 'Caption', type: 'string', default: '', description: 'Text shown above the graph.' },
    { key: 'unit', label: 'Unit', type: 'string', default: '', placeholder: '%, cores, ...' },
    { key: 'color', label: 'Line color', type: 'color', default: '#4f9eff' },
    { key: 'decimals', label: 'Decimals', type: 'number', default: 1, min: 0, max: 6, description: 'Digits after the decimal point for the current value.' },
  ],
  exampleConfig: {
    baseUrl: 'http://prometheus:9090',
    query: 'rate(node_cpu_seconds_total{mode="idle"}[5m])',
    rangeSeconds: 3600,
    step: 60,
    label: 'CPU IDLE',
    unit: '%',
    color: '#4f9eff',
    decimals: 1,
  },
};

/** Pull the first series' numeric values out of a Prometheus query_range response. */
function extractValues(value: unknown): number[] {
  const result = (value as { data?: { result?: Array<{ values?: Array<[number, string]> }> } })?.data?.result;
  if (!Array.isArray(result) || result.length === 0) return [];
  const raw = result[0]?.values;
  if (!Array.isArray(raw)) return [];
  return raw.map((pair) => parseFloat(pair[1])).filter((n) => Number.isFinite(n));
}

/** Build an SVG sparkline (line + soft area fill) from a numeric series. */
function sparkline(points: number[], color: string): string {
  const W = 220, H = 104, P = 4;
  const n = points.length;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = n > 1 ? (W - 2 * P) / (n - 1) : 0;
  const coords = points.map((v, i) => {
    const x = P + i * stepX;
    const y = P + (H - 2 * P) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const line = coords.map((c) => `${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  const area = `${first[0].toFixed(1)},${(H - P).toFixed(1)} ${line} ${last[0].toFixed(1)},${(H - P).toFixed(1)}`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polygon points="${area}" fill="${color}" fill-opacity="0.15"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

export const render: RenderFn = (ctx: RenderContext) => {
  const cfg = configSchema.parse(ctx.config);
  const series = ctx.data.series;
  const header = cfg.label ? ctx.brick.text({ content: cfg.label, size: 16, color: '#9aa7b4' }) : '';

  const noData = (caption = 'no data') =>
    ctx.brick.screen(
      ctx.brick.stack([header, ctx.brick.text({ content: caption, size: 24, color: '#7f93b5' })]),
      { bg: '#0c121d' },
    );

  // Diagnose, step by step, and log the precise reason for "no data".
  if (!series || !series.ok) {
    ctx.log.warn('No data: query_range fetch failed (is baseUrl reachable?)', { error: series?.error });
    return noData();
  }
  const raw = series.value as { status?: string; errorType?: string; error?: string; data?: { result?: unknown[] } };
  if (raw?.status === 'error') {
    ctx.log.warn(`Prometheus rejected the query: ${raw.errorType ?? ''} ${raw.error ?? ''}`.trim(), {
      query: cfg.query,
      errorType: raw.errorType,
      error: raw.error,
    });
    return noData('query error');
  }
  if (!Array.isArray(raw?.data?.result) || raw.data!.result!.length === 0) {
    ctx.log.warn('Prometheus query matched no series', {
      query: cfg.query,
      hint: 'the metric/labels may not exist, or the expression returns nothing',
    });
    return noData();
  }
  const points = extractValues(series.value);
  if (points.length === 0) {
    ctx.log.warn('Series has no numeric samples in the selected range', { rangeSeconds: cfg.rangeSeconds, step: cfg.step });
    return noData();
  }
  if (series.stale) ctx.log.debug('Rendering with stale (cached) data', { error: series.error });

  const last = points[points.length - 1]!;
  const valueText = ctx.brick.text({ content: last.toFixed(cfg.decimals) + (cfg.unit ? ' ' + cfg.unit : ''), size: 30, weight: 700 });
  const staleDot = series && series.stale
    ? '<div style="position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:#e0a000"></div>'
    : '';

  return ctx.brick.screen(
    [
      staleDot,
      ctx.brick.stack([header, valueText], { gap: 2 }),
      sparkline(points, cfg.color),
    ],
    { bg: '#0c121d', padding: 6 },
  );
};
