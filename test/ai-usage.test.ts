import { describe, it, expect } from 'vitest';
import { makeBricks } from '../src/plugins/brick.js';
import type { RenderContext } from '../src/plugins/types.js';
import { manifest, render } from '../plugins/ai-usage/index.js';
import {
  aiUsageConfigSchema,
  formatCountdown,
  formatPlanLabel,
  normalizeConfig,
  parseClaudeHeadersUsage,
  parseClaudeOAuthUsage,
  parseCodexUsage,
  severityFor,
} from '../plugins/ai-usage/parsers.js';

function testCtx(config: Record<string, unknown>): { ctx: RenderContext; logs: Array<{ level: string; message: string; meta?: unknown }> } {
  const data = {};
  const logs: Array<{ level: string; message: string; meta?: unknown }> = [];
  const mk = (level: string) => (message: string, meta?: unknown) => logs.push({ level, message, meta });
  return {
    ctx: {
      dashboardId: 'ai',
      config,
      data,
      now: new Date('2026-06-09T12:00:00Z'),
      brick: makeBricks(data),
      log: { debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') },
    },
    logs,
  };
}

const codexPayload = {
  plan_type: 'prolite',
  rate_limit: {
    primary_window: { used_percent: 42.4, reset_at: 1_780_000_000, limit_window_seconds: 18_000 },
    secondary_window: { used_percent: 68.8, reset_at: 1_780_500_000, limit_window_seconds: 604_800 },
  },
  code_review_rate_limit: {
    primary_window: { used_percent: 12, reset_at: 1_780_500_000, limit_window_seconds: 604_800 },
  },
  credits: { balance: 3, approx_local_messages: [10, 15], approx_cloud_messages: [4, 8] },
};

const claudePayload = {
  five_hour: { utilization: 33.2, resets_at: '2026-06-09T16:30:00Z' },
  seven_day: { utilization: 74.9, resets_at: '2026-06-14T08:00:00Z' },
};

describe('ai-usage config', () => {
  it('ships a valid example config and placeholder render', () => {
    expect(manifest.id).toBe('ai-usage');
    expect(manifest.name).toBe('AI Usage');
    expect(manifest.defaultDisplayDurationMs).toBe(15_000);
    expect(manifest.rerenderIntervalMs).toBe(60_000);
    expect(manifest.configSchema).toBeDefined();
    expect(manifest.configSchema!.safeParse(manifest.exampleConfig).success).toBe(true);

    const { ctx } = testCtx({ title: 'Usage Now', providers: ['claude'], mode: 'single' });
    expect(render(ctx)).toContain('Usage Now');
  });

  it('normalizes defaults for a minimal config', () => {
    expect(normalizeConfig({ providers: ['claude'] })).toEqual({
      providers: ['claude'],
      title: 'AI Usage',
      mode: 'auto',
      showCredits: true,
      showReview: true,
      theme: 'dark',
    });
  });

  it('rejects duplicate providers and invalid mode/provider combinations', () => {
    expect(() => aiUsageConfigSchema.parse({ providers: ['claude', 'claude'] })).toThrow(/duplicate/i);
    expect(() => aiUsageConfigSchema.parse({ providers: ['claude'], mode: 'both' })).toThrow(/both/i);
    expect(() => aiUsageConfigSchema.parse({ providers: ['claude', 'codex'], mode: 'single' })).toThrow(/single/i);
  });
});

describe('ai-usage parsers', () => {
  it('parses Codex wham usage windows, review, credits, and plan', () => {
    const usage = parseCodexUsage(codexPayload, 1_779_990_000);
    expect(usage).toMatchObject({ provider: 'codex', label: 'Codex', planLabel: 'Pro Lite', status: 'ok', fetchedAt: 1_779_990_000 });
    expect(usage.session).toMatchObject({ usedPercent: 42, resetAt: 1_780_000_000, windowSeconds: 18_000 });
    expect(usage.weekly).toMatchObject({ usedPercent: 69, resetAt: 1_780_500_000, windowSeconds: 604_800 });
    expect(usage.review).toMatchObject({ usedPercent: 12, resetAt: 1_780_500_000, windowSeconds: 604_800 });
    expect(usage.credits).toMatchObject({ balance: 3, localMessages: [10, 15], cloudMessages: [4, 8] });
  });

  it('parses Claude oauth usage windows', () => {
    const usage = parseClaudeOAuthUsage(claudePayload, 1_780_000_000);
    expect(usage).toMatchObject({ provider: 'claude', label: 'Claude', status: 'ok', fetchedAt: 1_780_000_000 });
    expect(usage.session).toMatchObject({ usedPercent: 33, resetAt: 1_781_022_600, windowSeconds: 18_000 });
    expect(usage.weekly).toMatchObject({ usedPercent: 75, resetAt: 1_781_424_000, windowSeconds: 604_800 });
  });

  it('parses Claude fallback response headers', () => {
    const headers = new Headers({
      'anthropic-ratelimit-unified-5h-utilization': '0.52',
      'anthropic-ratelimit-unified-5h-reset': '1780010000',
      'anthropic-ratelimit-unified-7d-utilization': '0.21',
      'anthropic-ratelimit-unified-7d-reset': '1780500000',
      'anthropic-ratelimit-unified-5h-status': 'ok',
    });
    const usage = parseClaudeHeadersUsage(headers, 1_780_000_000);
    expect(usage).toMatchObject({ provider: 'claude', label: 'Claude', status: 'ok', fetchedAt: 1_780_000_000 });
    expect(usage.session).toMatchObject({ usedPercent: 52, resetAt: 1_780_010_000, windowSeconds: 18_000 });
    expect(usage.weekly).toMatchObject({ usedPercent: 21, resetAt: 1_780_500_000, windowSeconds: 604_800 });
  });

  it('formats countdowns, plans, and severity thresholds', () => {
    expect(formatCountdown(1_780_003_600, 1_780_000_000)).toBe('1h 0m');
    expect(formatCountdown(1_780_172_800, 1_780_000_000)).toBe('2d 0h');
    expect(formatCountdown(1_779_999_999, 1_780_000_000)).toBe('now');
    expect(formatPlanLabel('prolite')).toBe('Pro Lite');
    expect(formatPlanLabel('pro_lite')).toBe('Pro Lite');
    expect(formatPlanLabel('pro-lite')).toBe('Pro Lite');
    expect(severityFor(49)).toBe('low');
    expect(severityFor(50)).toBe('mid');
    expect(severityFor(79)).toBe('mid');
    expect(severityFor(80)).toBe('critical');
  });
});
