import { describe, it, expect, vi } from 'vitest';

const fetchProvider = vi.hoisted(() => vi.fn());

vi.mock('../plugins/ai-usage/clients.js', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  defaultAiUsageFetcher: { fetch: fetchProvider },
}));
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
import { createAiUsageFetcher } from '../plugins/ai-usage/clients.js';
import { renderAiUsage } from '../plugins/ai-usage/render.js';
import type { ProviderUsage } from '../plugins/ai-usage/types.js';

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

const claudeUsage: ProviderUsage = {
  provider: 'claude',
  label: 'Claude',
  session: { usedPercent: 33, resetAt: 1_780_018_000, windowSeconds: 18_000 },
  weekly: { usedPercent: 75, resetAt: 1_780_604_800, windowSeconds: 604_800 },
  status: 'ok',
  fetchedAt: 1_780_000_000,
};

const codexUsage: ProviderUsage = {
  provider: 'codex',
  label: 'Codex',
  planLabel: 'Pro Lite',
  session: { usedPercent: 42, resetAt: 1_780_018_000, windowSeconds: 18_000 },
  weekly: { usedPercent: 69, resetAt: 1_780_604_800, windowSeconds: 604_800 },
  review: { usedPercent: 12, resetAt: 1_780_604_800, windowSeconds: 604_800 },
  credits: { balance: 3, localMessages: [10, 15], cloudMessages: [4, 8] },
  status: 'ok',
  fetchedAt: 1_780_000_000,
};

describe('ai-usage config', () => {
  it('ships a valid example config and render', async () => {
    expect(manifest.id).toBe('ai-usage');
    expect(manifest.name).toBe('AI Usage');
    expect(manifest.defaultDisplayDurationMs).toBe(15_000);
    expect(manifest.rerenderIntervalMs).toBe(60_000);
    expect(manifest.configSchema).toBeDefined();
    expect(manifest.configSchema!.safeParse(manifest.exampleConfig).success).toBe(true);
    expect(manifest.configFields?.some((field) => field.key === 'providers')).toBe(true);

    fetchProvider.mockReset();
    fetchProvider.mockResolvedValue(claudeUsage);
    const { ctx } = testCtx({ title: 'Usage Now', providers: ['claude'], mode: 'single' });
    await expect(render(ctx)).resolves.toContain('Usage Now');
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

  it('normalizes a form-backed single provider string with single mode', () => {
    expect(normalizeConfig({ providers: 'claude', mode: 'single' })).toMatchObject({
      providers: ['claude'],
      mode: 'single',
    });
  });

  it('rejects duplicate providers and invalid mode/provider combinations', () => {
    expect(() => aiUsageConfigSchema.parse({ providers: ['claude', 'claude'] })).toThrow(/duplicate/i);
    expect(() => aiUsageConfigSchema.parse({ providers: ['claude'], mode: 'both' })).toThrow(/both/i);
    expect(() => aiUsageConfigSchema.parse({ providers: ['claude', 'codex'], mode: 'single' })).toThrow(/single/i);
  });
});

describe('ai-usage plugin render', () => {
  it('fetches configured providers, logs degraded states, and renders usage', async () => {
    fetchProvider.mockReset();
    fetchProvider.mockImplementation(async (provider: string) => (provider === 'claude' ? claudeUsage : { ...codexUsage, status: 'stale' }));
    const { ctx, logs } = testCtx({ providers: ['claude', 'codex'], mode: 'both', title: 'AI Usage' });

    const html = await render(ctx);

    expect(fetchProvider).toHaveBeenCalledWith('claude');
    expect(fetchProvider).toHaveBeenCalledWith('codex');
    expect(logs).toContainEqual({
      level: 'warn',
      message: 'ai-usage provider degraded',
      meta: { provider: 'codex', status: 'stale', error: undefined },
    });
    expect(html).toContain('Claude');
    expect(html).toContain('Codex');
  });

  it('renders provider errors when fetch throws without logging secrets', async () => {
    fetchProvider.mockReset();
    fetchProvider.mockRejectedValue(new Error('token abc123 failed'));
    const { ctx, logs } = testCtx({ providers: ['codex'], mode: 'single', title: 'AI Usage' });

    const html = await render(ctx);

    expect(html).toContain('Codex');
    expect(html).toContain('token abc123 failed');
    expect(logs).toContainEqual({
      level: 'warn',
      message: 'ai-usage provider degraded',
      meta: { provider: 'codex', status: 'error', error: 'fetch failed' },
    });
  });
});

describe('ai-usage renderer', () => {
  it('renders a single provider layout with title, 5h, 7d, and percentages', () => {
    const html = renderAiUsage(
      { providers: ['claude'], title: 'Usage Now', mode: 'single', showCredits: true, showReview: true, theme: 'dark' },
      [claudeUsage],
      1_780_000_000,
    );

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Usage Now');
    expect(html).toContain('5h');
    expect(html).toContain('7d');
    expect(html).toContain('33%');
    expect(html).toContain('75%');
  });

  it('renders a dual provider layout with compact windows and Codex credits', () => {
    const html = renderAiUsage(
      { providers: ['claude', 'codex'], title: 'AI Usage', mode: 'both', showCredits: true, showReview: true, theme: 'dark' },
      [claudeUsage, codexUsage],
      1_780_000_000,
    );

    expect(html).toContain('AI Usage');
    expect(html).toContain('Claude');
    expect(html).toContain('Codex');
    expect(html).toContain('5h 33%');
    expect(html).toContain('7d 75%');
    expect(html).toContain('5h 42%');
    expect(html).toContain('7d 69%');
    expect(html).toContain('Credits 3');
  });

  it('renders provider-specific error card when no usage is available', () => {
    const html = renderAiUsage(
      { providers: ['codex'], title: 'AI Usage', mode: 'single', showCredits: true, showReview: true, theme: 'dark' },
      [
        {
          provider: 'codex',
          label: 'Codex',
          session: null,
          weekly: null,
          status: 'error',
          fetchedAt: null,
          error: 'auth file missing',
        },
      ],
      1_780_000_000,
    );

    expect(html).toContain('Codex');
    expect(html).toContain('auth file missing');
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

describe('ai-usage clients', () => {
  it('fetches Codex usage from wham using auth.json credentials', async () => {
    const readText = vi.fn(async (path: string) => {
      if (path === '/home/me/.codex/auth.json') {
        return JSON.stringify({
          tokens: {
            access_token: 'codex-access',
            refresh_token: 'codex-refresh',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
          last_active_account_id: 'acct_123',
        });
      }
      if (path === '/home/me/.codex/config.toml') return '';
      throw new Error(`unexpected read ${path}`);
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify(codexPayload), { status: 200 }));
    const usageFetcher = createAiUsageFetcher({
      nowMs: () => 1_779_990_000_000,
      readText,
      writeText: vi.fn(),
      fetch,
      homeDir: () => '/home/me',
    });

    const usage = await usageFetcher.fetch('codex');

    expect(readText).toHaveBeenCalledWith('/home/me/.codex/auth.json');
    expect(fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer codex-access',
          Accept: 'application/json',
          'ChatGPT-Account-Id': 'acct_123',
        }),
      }),
    );
    expect(usage).toMatchObject({ provider: 'codex', status: 'ok', session: { usedPercent: 42 }, weekly: { usedPercent: 69 } });
  });

  it('sends Codex account id from token block as ChatGPT-Account-Id', async () => {
    const readText = vi.fn(async (path: string) => {
      if (path === '/home/me/.codex/auth.json') {
        return JSON.stringify({
          tokens: {
            access_token: 'codex-access',
            refresh_token: 'codex-refresh',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            account_id: 'acct_tokens',
          },
        });
      }
      if (path === '/home/me/.codex/config.toml') return '';
      throw new Error(`unexpected read ${path}`);
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify(codexPayload), { status: 200 }));
    const usageFetcher = createAiUsageFetcher({
      nowMs: () => 1_779_990_000_000,
      readText,
      writeText: vi.fn(),
      fetch,
      homeDir: () => '/home/me',
    });

    await usageFetcher.fetch('codex');

    expect(fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          'ChatGPT-Account-Id': 'acct_tokens',
        }),
      }),
    );
  });

  it('uses wham usage path for configured Codex backend-api base URLs', async () => {
    const readText = vi.fn(async (path: string) => {
      if (path === '/home/me/.codex/auth.json') {
        return JSON.stringify({
          tokens: {
            access_token: 'codex-access',
            refresh_token: 'codex-refresh',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        });
      }
      if (path === '/home/me/.codex/config.toml') return 'chatgpt_base_url = "https://example.test/backend-api"';
      throw new Error(`unexpected read ${path}`);
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify(codexPayload), { status: 200 }));
    const usageFetcher = createAiUsageFetcher({
      nowMs: () => 1_779_990_000_000,
      readText,
      writeText: vi.fn(),
      fetch,
      homeDir: () => '/home/me',
    });

    await usageFetcher.fetch('codex');

    expect(fetch).toHaveBeenCalledWith('https://example.test/backend-api/wham/usage', expect.any(Object));
  });

  it('normalizes official Codex host base URL to backend-api wham usage', async () => {
    const readText = vi.fn(async (path: string) => {
      if (path === '/home/me/.codex/auth.json') {
        return JSON.stringify({
          tokens: {
            access_token: 'codex-access',
            refresh_token: 'codex-refresh',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        });
      }
      if (path === '/home/me/.codex/config.toml') return 'chatgpt_base_url = "https://chatgpt.com"';
      throw new Error(`unexpected read ${path}`);
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify(codexPayload), { status: 200 }));
    const usageFetcher = createAiUsageFetcher({
      nowMs: () => 1_779_990_000_000,
      readText,
      writeText: vi.fn(),
      fetch,
      homeDir: () => '/home/me',
    });

    await usageFetcher.fetch('codex');

    expect(fetch).toHaveBeenCalledWith('https://chatgpt.com/backend-api/wham/usage', expect.any(Object));
  });

  it('refreshes Codex credentials when last_refresh is inside the refresh window and persists last_refresh', async () => {
    const readText = vi.fn(async (path: string) => {
      if (path === '/home/me/.codex/auth.json') {
        return JSON.stringify({
          tokens: {
            access_token: 'old-codex-access',
            refresh_token: 'codex-refresh',
            account_id: 'acct_tokens',
          },
          last_refresh: '2026-05-28T19:31:39.000Z',
        });
      }
      if (path === '/home/me/.codex/config.toml') return '';
      throw new Error(`unexpected read ${path}`);
    });
    const writeText = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-codex-access', refresh_token: 'new-codex-refresh', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(codexPayload), { status: 200 }));
    const usageFetcher = createAiUsageFetcher({
      nowMs: () => 1_780_000_000_000,
      readText,
      writeText,
      fetch,
      homeDir: () => '/home/me',
    });

    await usageFetcher.fetch('codex');

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://auth.openai.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
          grant_type: 'refresh_token',
          refresh_token: 'codex-refresh',
          scope: 'openid profile email',
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new-codex-access' }),
      }),
    );
    expect(writeText).toHaveBeenCalledWith(
      '/home/me/.codex/auth.json',
      expect.stringContaining('"last_refresh": "2026-05-28T20:26:40.000Z"'),
    );
    const persisted = JSON.parse(writeText.mock.calls[0]?.[1] as string);
    expect(persisted.tokens).toMatchObject({ access_token: 'new-codex-access', refresh_token: 'new-codex-refresh' });
  });

  it('uses refreshed Codex last_refresh instead of stale expires_at when refresh omits expires_in', async () => {
    let storedAuth = JSON.stringify({
      tokens: {
        access_token: 'old-codex-access',
        refresh_token: 'codex-refresh',
        expires_at: 1_779_000_000,
      },
      last_refresh: '2026-05-28T19:31:39.000Z',
    });
    const readText = vi.fn(async (path: string) => {
      if (path === '/home/me/.codex/auth.json') return storedAuth;
      if (path === '/home/me/.codex/config.toml') return '';
      throw new Error(`unexpected read ${path}`);
    });
    const writeText = vi.fn(async (_path: string, text: string) => {
      storedAuth = text;
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-codex-access', refresh_token: 'new-codex-refresh' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(codexPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(codexPayload), { status: 200 }));
    const usageFetcher = createAiUsageFetcher(
      {
        nowMs: () => 1_780_000_000_000,
        readText,
        writeText,
        fetch,
        homeDir: () => '/home/me',
      },
      { ttlMs: 0 },
    );

    await usageFetcher.fetch('codex');
    await usageFetcher.fetch('codex');

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://auth.openai.com/oauth/token', expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new-codex-access' }),
      }),
    );
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('refreshes near-expiry Claude credentials with Anthropic client id', async () => {
    const readText = vi.fn(async (path: string) => {
      expect(path).toBe('/home/me/.claude/.credentials.json');
      return JSON.stringify({
        claudeAiOauth: {
          accessToken: 'old-claude-access',
          refreshToken: 'claude-refresh',
          expiresAt: 1_780_000_001_000,
        },
      });
    });
    const writeText = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-claude-access', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(claudePayload), { status: 200 }));
    const usageFetcher = createAiUsageFetcher({
      nowMs: () => 1_780_000_000_000,
      readText,
      writeText,
      fetch,
      homeDir: () => '/home/me',
    });

    await usageFetcher.fetch('claude');

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://console.anthropic.com/v1/oauth/token',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams),
      }),
    );
    const refreshBody = fetch.mock.calls[0]?.[1]?.body;
    expect(refreshBody).toBeInstanceOf(URLSearchParams);
    expect(refreshBody.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer new-claude-access' }),
      }),
    );
    expect(writeText).toHaveBeenCalled();
  });

  it('uses existing Claude access token when near-expiry proactive refresh fails before expiry', async () => {
    const readText = vi.fn(async (path: string) => {
      expect(path).toBe('/home/me/.claude/.credentials.json');
      return JSON.stringify({
        claudeAiOauth: {
          accessToken: 'old-claude-access',
          refreshToken: 'claude-refresh',
          expiresAt: 1_780_000_001_000,
        },
      });
    });
    const writeText = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(claudePayload), { status: 200 }));
    const usageFetcher = createAiUsageFetcher({
      nowMs: () => 1_780_000_000_000,
      readText,
      writeText,
      fetch,
      homeDir: () => '/home/me',
    });

    const usage = await usageFetcher.fetch('claude');

    expect(fetch).toHaveBeenNthCalledWith(1, 'https://console.anthropic.com/v1/oauth/token', expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer old-claude-access' }),
      }),
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(usage).toMatchObject({ provider: 'claude', status: 'ok', session: { usedPercent: 33 } });
  });

  it('fetches Claude usage using claudeAiOauth credentials', async () => {
    const readText = vi.fn(async (path: string) => {
      expect(path).toBe('/home/me/.claude/.credentials.json');
      return JSON.stringify({
        claudeAiOauth: {
          accessToken: 'claude-access',
          refreshToken: 'claude-refresh',
          expiresAt: Date.now() + 3_600_000,
        },
      });
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify(claudePayload), { status: 200 }));
    const usageFetcher = createAiUsageFetcher({
      nowMs: () => 1_780_000_000_000,
      readText,
      writeText: vi.fn(),
      fetch,
      homeDir: () => '/home/me',
    });

    const usage = await usageFetcher.fetch('claude');

    expect(readText).toHaveBeenCalledWith('/home/me/.claude/.credentials.json');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer claude-access',
          Accept: 'application/json',
          'anthropic-beta': 'oauth-2025-04-20',
        }),
      }),
    );
    expect(usage).toMatchObject({ provider: 'claude', status: 'ok', session: { usedPercent: 33 }, weekly: { usedPercent: 75 } });
  });

  it('returns stale last-good usage when an expired cache refresh hits a transient fetch error', async () => {
    let now = 1_779_990_000_000;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(codexPayload), { status: 200 }))
      .mockRejectedValueOnce(new Error('network down'));
    const usageFetcher = createAiUsageFetcher({
      nowMs: () => now,
      readText: vi.fn(async () =>
        JSON.stringify({
          tokens: { access_token: 'codex-access', refresh_token: 'codex-refresh', expires_at: Math.floor(now / 1000) + 3600 },
        }),
      ),
      writeText: vi.fn(),
      fetch,
      homeDir: () => '/home/me',
    });

    const fresh = await usageFetcher.fetch('codex');
    now += 61_000;
    const stale = await usageFetcher.fetch('codex');

    expect(fresh.status).toBe('ok');
    expect(stale).toMatchObject({ provider: 'codex', status: 'stale', error: 'network down', session: { usedPercent: 42 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
