import type { PluginManifest, RenderFn } from '../../src/plugins/types.js';
import { aiUsageConfigSchema } from './parsers.js';

export const manifest: PluginManifest = {
  id: 'ai-usage',
  name: 'AI Usage',
  defaultDisplayDurationMs: 15_000,
  rerenderIntervalMs: 60_000,
  configSchema: aiUsageConfigSchema,
  configFields: [
    { key: 'title', label: 'Title', type: 'string', default: 'AI Usage' },
    {
      key: 'mode',
      label: 'Layout mode',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'single', label: 'Single provider' },
        { value: 'both', label: 'Both providers' },
      ],
    },
    { key: 'showCredits', label: 'Show Codex credits', type: 'boolean', default: true },
    { key: 'showReview', label: 'Show Codex review quota', type: 'boolean', default: true },
  ],
  exampleConfig: {
    providers: ['claude', 'codex'],
    title: 'AI Usage',
    mode: 'auto',
    showCredits: true,
    showReview: true,
    theme: 'dark',
  },
};

export const render: RenderFn = (ctx) => {
  const cfg = aiUsageConfigSchema.parse(ctx.config);
  return ctx.brick.screen(ctx.brick.text({ content: cfg.title, size: 24 }), { bg: '#000000' });
};
