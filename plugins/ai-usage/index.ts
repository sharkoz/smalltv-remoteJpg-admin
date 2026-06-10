import type { PluginManifest, RenderFn } from '../../src/plugins/types.js';
import { defaultAiUsageFetcher } from './clients.js';
import { aiUsageConfigSchema } from './parsers.js';
import { renderAiUsage } from './render.js';
import type { ProviderUsage } from './types.js';

export const manifest: PluginManifest = {
  id: 'ai-usage',
  name: 'AI Usage',
  defaultDisplayDurationMs: 15_000,
  rerenderIntervalMs: 60_000,
  configSchema: aiUsageConfigSchema,
  configFields: [
    { key: 'title', label: 'Title', type: 'string', default: 'AI Usage' },
    {
      key: 'providers',
      label: 'Providers',
      type: 'string',
      default: 'claude,codex',
      placeholder: 'claude,codex',
      description: 'Comma- or space-separated providers: claude, codex.',
    },
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


export const render: RenderFn = async (ctx) => {
  const cfg = aiUsageConfigSchema.parse(ctx.config);
  const usages: ProviderUsage[] = [];

  for (const provider of cfg.providers) {
    try {
      const usage = await defaultAiUsageFetcher.fetch(provider);
      usages.push(usage);
      if (usage.status !== 'ok') {
        ctx.log.warn('ai-usage provider degraded', { provider, status: usage.status, error: usage.error ? 'fetch failed' : undefined });
      }
    } catch (error) {
      ctx.log.warn('ai-usage provider degraded', { provider, status: 'error', error: 'fetch failed' });
      usages.push({
        provider,
        label: provider === 'claude' ? 'Claude' : 'Codex',
        session: null,
        weekly: null,
        status: 'error',
        fetchedAt: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return renderAiUsage(cfg, usages, Math.floor(ctx.now.getTime() / 1000));
};
