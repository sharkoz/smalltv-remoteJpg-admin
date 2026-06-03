import { z } from 'zod';
import type { PluginManifest, RenderFn } from '../../src/plugins/types.js';

const configSchema = z.object({
  /** Request URL. May reference {{secret.*}} (e.g. an API key). */
  url: z.string().url(),
  /** Dotted path into the JSON response to display, e.g. "data.price". Empty = whole body. */
  jsonPath: z.string().default(''),
  /** Caption shown above the value. */
  label: z.string().default(''),
  /** Optional unit/suffix appended to the value. */
  unit: z.string().default(''),
});

export const manifest: PluginManifest = {
  id: 'api-value',
  name: 'API Value',
  defaultDisplayDurationMs: 15_000,
  dataSources: [
    {
      id: 'main',
      // Resolved per-dashboard against its config at fetch time.
      url: '{{config.url}}',
      method: 'GET',
      refreshIntervalMs: 60_000,
      responseType: 'json',
    },
  ],
  configSchema,
  configFields: [
    { key: 'url', label: 'API URL', type: 'string', required: true, placeholder: 'https://api.example.com/data', description: 'JSON endpoint to fetch. May contain {{secret.name}} for API keys.' },
    { key: 'jsonPath', label: 'JSON path', type: 'string', default: '', placeholder: 'rates.EUR', description: 'Dotted path to the value inside the response.' },
    { key: 'label', label: 'Caption', type: 'string', default: '', description: 'Text shown above the value.' },
    { key: 'unit', label: 'Unit', type: 'string', default: '', placeholder: '€, %, ...', description: 'Suffix shown under the value.' },
  ],
  exampleConfig: {
    url: 'https://api.frankfurter.app/latest?from=USD&to=EUR',
    jsonPath: 'rates.EUR',
    label: 'USD - EUR',
    unit: 'EUR per USD',
  },
};

export const render: RenderFn = (ctx) => {
  const cfg = configSchema.parse(ctx.config);
  const theme = ctx.theme;
  return ctx.brick.screen(
    ctx.brick.stack([
      cfg.label ? ctx.brick.text({ content: cfg.label, size: 18, color: theme.muted }) : '',
      ctx.brick.value({ source: 'main', path: cfg.jsonPath, size: 48, fallback: '—', color: theme.text }),
      cfg.unit ? ctx.brick.text({ content: cfg.unit, size: 16, color: theme.muted }) : '',
    ]),
    { bg: theme.bg, color: theme.text, font: theme.font },
  );
};
