# AI Usage Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one `ai-usage` SmallTV plugin that displays Claude and/or Codex subscription quota usage on a 240x240 dashboard.

**Architecture:** Add a focused plugin package under `plugins/ai-usage/` with pure parsers/formatters, provider clients for Claude and Codex CLI OAuth credentials, in-memory stale-aware cache, and an HTML renderer. Tests use fixture payloads and mocked credential/network functions; no live Anthropic/OpenAI calls.

**Tech Stack:** TypeScript ESM/NodeNext, Zod, Vitest, existing SmallTV plugin contract, Node `fetch`, Node filesystem APIs.

---

## File Structure

Create:

- `plugins/ai-usage/types.ts` — shared `Provider`, `UsageWindow`, `ProviderUsage`, `AiUsageConfig`, and provider dependency types.
- `plugins/ai-usage/parsers.ts` — pure parsers for Codex `wham/usage`, Claude `/api/oauth/usage`, Claude fallback headers, severity, countdown formatting, config normalization.
- `plugins/ai-usage/clients.ts` — credential loading, OAuth refresh, usage fetch, and per-provider cache.
- `plugins/ai-usage/render.ts` — pure HTML renderer for single-provider and dual-provider layouts.
- `plugins/ai-usage/index.ts` — plugin `manifest`, `configSchema`, `configFields`, `exampleConfig`, and `render` wiring.
- `test/ai-usage.test.ts` — unit tests for config, parsers, render, stale cache, and plugin loader integration.

Modify after the plugin works:

- `README.md` — add `ai-usage` to built-in plugin docs and mention credential requirements.

Do not change the core plugin ABI unless a test proves it is unavoidable.

---

### Task 1: Add Pure Types, Config, and Parser Tests

**Files:**
- Create: `plugins/ai-usage/types.ts`
- Create: `plugins/ai-usage/parsers.ts`
- Create: `test/ai-usage.test.ts`

- [ ] **Step 1: Write failing config and parser tests**

Add the first test file with only pure tests. Use exact fixtures inline so no network or credentials are required.

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { makeBricks } from '../src/plugins/brick.js';
import type { RenderContext } from '../src/plugins/types.js';
import { manifest, render } from '../plugins/ai-usage/index.js';
import {
  aiUsageConfigSchema,
  formatCountdown,
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
  it('ships a valid example config', () => {
    expect(manifest.configSchema).toBeDefined();
    expect(manifest.configSchema!.safeParse(manifest.exampleConfig).success).toBe(true);
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
    expect(usage).toMatchObject({ provider: 'codex', label: 'Codex', planLabel: 'Pro Lite', status: 'ok' });
    expect(usage.session).toMatchObject({ usedPercent: 42, resetAt: 1_780_000_000, windowSeconds: 18_000 });
    expect(usage.weekly).toMatchObject({ usedPercent: 69, resetAt: 1_780_500_000, windowSeconds: 604_800 });
    expect(usage.review).toMatchObject({ usedPercent: 12 });
    expect(usage.credits).toMatchObject({ balance: 3, localMessages: [10, 15], cloudMessages: [4, 8] });
  });

  it('parses Claude oauth usage windows', () => {
    const usage = parseClaudeOAuthUsage(claudePayload, 1_780_000_000);
    expect(usage).toMatchObject({ provider: 'claude', label: 'Claude', status: 'ok' });
    expect(usage.session).toMatchObject({ usedPercent: 33, resetAt: 1_780_157_600, windowSeconds: 18_000 });
    expect(usage.weekly).toMatchObject({ usedPercent: 75, resetAt: 1_780_577_600, windowSeconds: 604_800 });
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
    expect(usage.session?.usedPercent).toBe(52);
    expect(usage.weekly?.usedPercent).toBe(21);
  });

  it('formats countdowns and severity thresholds', () => {
    expect(formatCountdown(1_780_003_600, 1_780_000_000)).toBe('1h 0m');
    expect(formatCountdown(1_780_172_800, 1_780_000_000)).toBe('2d 0h');
    expect(severityFor(49)).toBe('low');
    expect(severityFor(50)).toBe('mid');
    expect(severityFor(80)).toBe('critical');
  });
});
```

- [ ] **Step 2: Run the failing parser tests**

Run:

```bash
npm run test -- test/ai-usage.test.ts
```

Expected: FAIL because `plugins/ai-usage/*` does not exist.

- [ ] **Step 3: Add shared types**

Create `plugins/ai-usage/types.ts`:

```ts
export type Provider = 'claude' | 'codex';
export type LayoutMode = 'auto' | 'single' | 'both';
export type Theme = 'dark';
export type UsageStatus = 'ok' | 'stale' | 'error';
export type Severity = 'low' | 'mid' | 'critical';

export interface AiUsageConfig {
  providers: Provider[];
  title: string;
  mode: LayoutMode;
  showCredits: boolean;
  showReview: boolean;
  theme: Theme;
}

export interface UsageWindow {
  usedPercent: number;
  resetAt: number | null;
  windowSeconds: number | null;
}

export interface ProviderUsage {
  provider: Provider;
  label: string;
  planLabel?: string;
  session: UsageWindow | null;
  weekly: UsageWindow | null;
  review?: UsageWindow | null;
  credits?: {
    balance?: number | string;
    localMessages?: [number, number];
    cloudMessages?: [number, number];
  } | null;
  status: UsageStatus;
  fetchedAt: number | null;
  error?: string;
}

export interface FetchDeps {
  nowMs(): number;
  readText(path: string): Promise<string>;
  writeText(path: string, value: string): Promise<void>;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  homeDir(): string;
}
```

- [ ] **Step 4: Add parsers and config schema**

Create `plugins/ai-usage/parsers.ts`:

```ts
import { z } from 'zod';
import type { AiUsageConfig, ProviderUsage, Severity, UsageWindow } from './types.js';

const providerSchema = z.enum(['claude', 'codex']);

export const aiUsageConfigSchema = z.object({
  providers: z.array(providerSchema).min(1).max(2).default(['claude', 'codex']),
  title: z.string().default('AI Usage'),
  mode: z.enum(['auto', 'single', 'both']).default('auto'),
  showCredits: z.boolean().default(true),
  showReview: z.boolean().default(true),
  theme: z.literal('dark').default('dark'),
}).superRefine((cfg, ctx) => {
  if (new Set(cfg.providers).size !== cfg.providers.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'providers must not contain duplicate values', path: ['providers'] });
  }
  if (cfg.mode === 'single' && cfg.providers.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'mode single requires exactly one provider', path: ['mode'] });
  }
  if (cfg.mode === 'both' && cfg.providers.length !== 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'mode both requires exactly two providers', path: ['mode'] });
  }
});

export type ParsedAiUsageConfig = z.infer<typeof aiUsageConfigSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(root: unknown, ...path: string[]): Record<string, unknown> | null {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return isRecord(current) ? current : null;
}

function stringAt(root: unknown, ...path: string[]): string | null {
  const parent = path.length > 1 ? recordAt(root, ...path.slice(0, -1)) : root;
  if (!isRecord(parent)) return null;
  const value = parent[path[path.length - 1]!];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberAt(root: unknown, ...path: string[]): number | null {
  const parent = path.length > 1 ? recordAt(root, ...path.slice(0, -1)) : root;
  if (!isRecord(parent)) return null;
  const value = parent[path[path.length - 1]!];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseWindow(root: unknown, fallbackWindowSeconds: number): UsageWindow | null {
  const used = numberAt(root, 'used_percent') ?? numberAt(root, 'utilization');
  const resetAt = numberAt(root, 'reset_at');
  const resetIso = stringAt(root, 'resets_at');
  const parsedReset = resetAt ?? (resetIso ? Math.round(Date.parse(resetIso) / 1000) : null);
  const windowSeconds = numberAt(root, 'limit_window_seconds') ?? fallbackWindowSeconds;
  if (used === null) return null;
  return {
    usedPercent: clampPercent(used),
    resetAt: Number.isFinite(parsedReset) ? parsedReset : null,
    windowSeconds,
  };
}

export function severityFor(percent: number): Severity {
  if (percent >= 80) return 'critical';
  if (percent >= 50) return 'mid';
  return 'low';
}

export function formatCountdown(resetAt: number | null, nowSeconds: number): string {
  if (!resetAt || resetAt <= nowSeconds) return 'now';
  const totalMinutes = Math.max(0, Math.round((resetAt - nowSeconds) / 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `${hours}h ${minutes}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatPlanLabel(raw: string | null): string | undefined {
  if (!raw) return undefined;
  if (raw === 'prolite' || raw === 'pro_lite' || raw === 'pro-lite') return 'Pro Lite';
  return raw.split(/[_-]+/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ');
}

export function parseCodexUsage(raw: unknown, nowSeconds: number): ProviderUsage {
  const primary = recordAt(raw, 'rate_limit', 'primary_window');
  const secondary = recordAt(raw, 'rate_limit', 'secondary_window');
  const session = parseWindow(primary, 18_000);
  const weekly = parseWindow(secondary, 604_800);
  if (!session || !weekly) throw new Error('Codex usage payload missing primary or secondary rate-limit window');
  const review = parseWindow(recordAt(raw, 'code_review_rate_limit', 'primary_window'), 604_800);
  const credits = recordAt(raw, 'credits');
  const local = credits ? [numberAt(credits, 'approx_local_messages', '0') ?? 0, numberAt(credits, 'approx_local_messages', '1') ?? 0] as [number, number] : undefined;
  const cloud = credits ? [numberAt(credits, 'approx_cloud_messages', '0') ?? 0, numberAt(credits, 'approx_cloud_messages', '1') ?? 0] as [number, number] : undefined;
  return {
    provider: 'codex',
    label: 'Codex',
    planLabel: formatPlanLabel(stringAt(raw, 'plan_type')),
    session,
    weekly,
    review,
    credits: credits ? { balance: numberAt(credits, 'balance') ?? stringAt(credits, 'balance') ?? undefined, localMessages: local, cloudMessages: cloud } : null,
    status: 'ok',
    fetchedAt: nowSeconds,
  };
}

export function parseClaudeOAuthUsage(raw: unknown, nowSeconds: number): ProviderUsage {
  const session = parseWindow(recordAt(raw, 'five_hour'), 18_000);
  const weekly = parseWindow(recordAt(raw, 'seven_day'), 604_800);
  if (!session || !weekly) throw new Error('Claude usage payload missing five_hour or seven_day usage window');
  return { provider: 'claude', label: 'Claude', session, weekly, status: 'ok', fetchedAt: nowSeconds };
}

export function parseClaudeHeadersUsage(headers: Headers, nowSeconds: number): ProviderUsage {
  const pct = (key: string): number | null => {
    const value = headers.get(key);
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clampPercent(parsed * 100) : null;
  };
  const reset = (key: string): number | null => {
    const value = headers.get(key);
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  };
  const sessionPct = pct('anthropic-ratelimit-unified-5h-utilization');
  const weeklyPct = pct('anthropic-ratelimit-unified-7d-utilization');
  if (sessionPct === null || weeklyPct === null) throw new Error('Claude response headers missing unified usage values');
  return {
    provider: 'claude',
    label: 'Claude',
    session: { usedPercent: sessionPct, resetAt: reset('anthropic-ratelimit-unified-5h-reset'), windowSeconds: 18_000 },
    weekly: { usedPercent: weeklyPct, resetAt: reset('anthropic-ratelimit-unified-7d-reset'), windowSeconds: 604_800 },
    status: 'ok',
    fetchedAt: nowSeconds,
  };
}

export function normalizeConfig(input: Record<string, unknown>): AiUsageConfig {
  return aiUsageConfigSchema.parse(input);
}
```

- [ ] **Step 5: Add a temporary plugin index so tests can import**

Create `plugins/ai-usage/index.ts` with only manifest wiring and a simple render. This is allowed because Task 2 will replace the renderer after parser tests pass.

```ts
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
    { key: 'mode', label: 'Layout mode', type: 'select', default: 'auto', options: [
      { value: 'auto', label: 'Auto' },
      { value: 'single', label: 'Single provider' },
      { value: 'both', label: 'Both providers' },
    ] },
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
```

- [ ] **Step 6: Run parser tests to green**

Run:

```bash
npm run test -- test/ai-usage.test.ts
```

Expected: PASS for config/parser tests. If TypeScript rejects tuple parsing for `approx_*_messages`, replace the `numberAt(..., '0')` access with direct array parsing helpers before continuing.

- [ ] **Step 7: Commit Task 1**

```bash
git add plugins/ai-usage/types.ts plugins/ai-usage/parsers.ts plugins/ai-usage/index.ts test/ai-usage.test.ts
git commit -m "feat: add AI usage parser foundation"
```

---

### Task 2: Add Provider Clients and Stale Cache

**Files:**
- Create: `plugins/ai-usage/clients.ts`
- Modify: `test/ai-usage.test.ts`

- [ ] **Step 1: Add failing client tests**

Append to `test/ai-usage.test.ts`:

```ts
import { createAiUsageFetcher } from '../plugins/ai-usage/clients.js';
import type { FetchDeps } from '../plugins/ai-usage/types.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function depsWith(opts: { files?: Record<string, string>; responses?: Response[]; nowMs?: number }): FetchDeps & { writes: Record<string, string>; urls: string[] } {
  const files = opts.files ?? {};
  const responses = [...(opts.responses ?? [])];
  const writes: Record<string, string> = {};
  const urls: string[] = [];
  return {
    writes,
    urls,
    nowMs: () => opts.nowMs ?? 1_780_000_000_000,
    homeDir: () => '/home/me',
    readText: async (path) => {
      const value = files[path];
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
    writeText: async (path, value) => { writes[path] = value; },
    fetch: async (input, init) => {
      urls.push(String(input));
      const response = responses.shift();
      if (!response) throw new Error('no response queued');
      return response;
    },
  };
}

describe('ai-usage clients', () => {
  it('fetches Codex usage with Codex CLI OAuth credentials', async () => {
    const deps = depsWith({
      files: {
        '/home/me/.codex/auth.json': JSON.stringify({ tokens: { access_token: 'at', refresh_token: 'rt', account_id: 'acct' }, last_refresh: '2026-06-09T00:00:00Z' }),
      },
      responses: [jsonResponse(codexPayload)],
    });
    const fetcher = createAiUsageFetcher(deps);
    const usage = await fetcher.fetchProvider('codex');
    expect(deps.urls[0]).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(usage.provider).toBe('codex');
    expect(usage.weekly?.usedPercent).toBe(69);
  });

  it('fetches Claude oauth usage with Claude CLI credentials', async () => {
    const deps = depsWith({
      files: {
        '/home/me/.claude/.credentials.json': JSON.stringify({ claudeAiOauth: { accessToken: 'cat', refreshToken: 'crt', expiresAt: 1_780_100_000_000 } }),
      },
      responses: [jsonResponse(claudePayload)],
    });
    const fetcher = createAiUsageFetcher(deps);
    const usage = await fetcher.fetchProvider('claude');
    expect(deps.urls[0]).toBe('https://api.anthropic.com/api/oauth/usage');
    expect(usage.provider).toBe('claude');
    expect(usage.session?.usedPercent).toBe(33);
  });

  it('returns stale last-good data after a transient provider failure', async () => {
    const deps = depsWith({
      files: {
        '/home/me/.codex/auth.json': JSON.stringify({ tokens: { access_token: 'at', refresh_token: 'rt' }, last_refresh: '2026-06-09T00:00:00Z' }),
      },
      responses: [jsonResponse(codexPayload)],
      nowMs: 1_780_000_000_000,
    });
    const fetcher = createAiUsageFetcher(deps, { ttlMs: 1 });
    await fetcher.fetchProvider('codex');
    deps.fetch = async () => { throw new Error('network down'); };
    deps.nowMs = () => 1_780_000_010_000;
    const stale = await fetcher.fetchProvider('codex');
    expect(stale.status).toBe('stale');
    expect(stale.error).toContain('network down');
    expect(stale.weekly?.usedPercent).toBe(69);
  });
});
```

- [ ] **Step 2: Run client tests to verify they fail**

Run:

```bash
npm run test -- test/ai-usage.test.ts
```

Expected: FAIL because `plugins/ai-usage/clients.ts` does not exist.

- [ ] **Step 3: Implement provider clients and cache**

Create `plugins/ai-usage/clients.ts`:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { FetchDeps, Provider, ProviderUsage } from './types.js';
import { parseClaudeOAuthUsage, parseCodexUsage } from './parsers.js';

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const defaultDeps: FetchDeps = {
  nowMs: () => Date.now(),
  readText: (path) => readFile(path, 'utf8'),
  writeText: (path, value) => writeFile(path, value, 'utf8'),
  fetch: (input, init) => fetch(input, init),
  homeDir: () => homedir(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nested(root: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = root[key];
  return isRecord(value) ? value : null;
}

async function readJson(deps: FetchDeps, path: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await deps.readText(path)) as unknown;
  if (!isRecord(parsed)) throw new Error(`Unexpected JSON shape in ${path}`);
  return parsed;
}

function secondsNow(deps: FetchDeps): number {
  return Math.floor(deps.nowMs() / 1000);
}

function staleCopy(value: ProviderUsage, error: unknown): ProviderUsage {
  return { ...value, status: 'stale', error: error instanceof Error ? error.message : String(error) };
}

async function fetchJson(deps: FetchDeps, url: string, init: RequestInit): Promise<unknown> {
  const response = await deps.fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadCodexAuth(deps: FetchDeps): Promise<{ path: string; raw: Record<string, unknown>; accessToken: string; refreshToken: string | null; accountId: string | null; lastRefreshMs: number | null }> {
  const path = `${deps.homeDir()}/.codex/auth.json`;
  const raw = await readJson(deps, path);
  const tokens = nested(raw, 'tokens');
  if (!tokens) throw new Error('No Codex OAuth tokens found. Run: codex login');
  const accessToken = stringValue(tokens.access_token);
  if (!accessToken) throw new Error('Missing Codex access token. Run: codex login');
  const refreshToken = stringValue(tokens.refresh_token);
  const accountId = stringValue(tokens.account_id);
  const lastRefreshRaw = stringValue(raw.last_refresh);
  const lastRefreshMs = lastRefreshRaw ? Date.parse(lastRefreshRaw) : null;
  return { path, raw, accessToken, refreshToken, accountId, lastRefreshMs: Number.isFinite(lastRefreshMs) ? lastRefreshMs : null };
}

async function maybeRefreshCodex(deps: FetchDeps, auth: Awaited<ReturnType<typeof loadCodexAuth>>): Promise<typeof auth> {
  if (!auth.refreshToken) return auth;
  if (auth.lastRefreshMs && deps.nowMs() - auth.lastRefreshMs < 8 * 24 * 60 * 60 * 1000) return auth;
  const body = JSON.stringify({ client_id: CODEX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: auth.refreshToken, scope: 'openid profile email' });
  const response = await deps.fetch('https://auth.openai.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!response.ok) return auth;
  const payload = await response.json() as unknown;
  if (!isRecord(payload)) return auth;
  const newAccessToken = stringValue(payload.access_token) ?? auth.accessToken;
  const newRefreshToken = stringValue(payload.refresh_token) ?? auth.refreshToken;
  const tokens = nested(auth.raw, 'tokens');
  if (tokens) {
    tokens.access_token = newAccessToken;
    tokens.refresh_token = newRefreshToken;
    auth.raw.last_refresh = new Date(deps.nowMs()).toISOString();
    await deps.writeText(auth.path, JSON.stringify(auth.raw, null, 2));
  }
  return { ...auth, accessToken: newAccessToken, refreshToken: newRefreshToken, lastRefreshMs: deps.nowMs() };
}

async function resolveCodexBaseUrl(deps: FetchDeps): Promise<string> {
  try {
    const text = await deps.readText(`${deps.homeDir()}/.codex/config.toml`);
    const line = text.split(/\r?\n/).map((entry) => entry.split('#', 1)[0]!.trim()).find((entry) => entry.startsWith('chatgpt_base_url'));
    const value = line?.split('=', 2)[1]?.trim().replace(/^['"]|['"]$/g, '');
    if (value) {
      const normalized = value.replace(/\/+$/, '');
      if ((normalized.startsWith('https://chatgpt.com') || normalized.startsWith('https://chat.openai.com')) && !normalized.includes('/backend-api')) {
        return `${normalized}/backend-api`;
      }
      return normalized;
    }
  } catch {
    return 'https://chatgpt.com/backend-api';
  }
  return 'https://chatgpt.com/backend-api';
}

async function fetchCodex(deps: FetchDeps): Promise<ProviderUsage> {
  const auth = await maybeRefreshCodex(deps, await loadCodexAuth(deps));
  const baseUrl = await resolveCodexBaseUrl(deps);
  const path = baseUrl.includes('/backend-api') ? '/wham/usage' : '/api/codex/usage';
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.accessToken}`, Accept: 'application/json', 'User-Agent': 'smalltv-ai-usage' };
  if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId;
  const body = await fetchJson(deps, `${baseUrl}${path}`, { headers });
  return parseCodexUsage(body, secondsNow(deps));
}

async function loadClaudeAuth(deps: FetchDeps): Promise<{ path: string; raw: Record<string, unknown>; oauth: Record<string, unknown>; accessToken: string; refreshToken: string | null; expiresAtMs: number | null }> {
  const path = `${deps.homeDir()}/.claude/.credentials.json`;
  const raw = await readJson(deps, path);
  const oauth = nested(raw, 'claudeAiOauth');
  if (!oauth) throw new Error('No Claude OAuth credentials found. Run: claude');
  const accessToken = stringValue(oauth.accessToken);
  if (!accessToken) throw new Error('Missing Claude access token. Run: claude');
  return { path, raw, oauth, accessToken, refreshToken: stringValue(oauth.refreshToken), expiresAtMs: numberValue(oauth.expiresAt) };
}

async function maybeRefreshClaude(deps: FetchDeps, auth: Awaited<ReturnType<typeof loadClaudeAuth>>): Promise<typeof auth> {
  if (!auth.refreshToken || !auth.expiresAtMs || auth.expiresAtMs >= deps.nowMs() + REFRESH_BUFFER_MS) return auth;
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: CLAUDE_CLIENT_ID, refresh_token: auth.refreshToken });
  const response = await deps.fetch('https://console.anthropic.com/v1/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw new Error(`Claude token refresh failed: HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  if (!isRecord(payload)) throw new Error('Invalid Claude token refresh payload');
  const accessToken = stringValue(payload.access_token);
  const expiresIn = numberValue(payload.expires_in);
  if (!accessToken || expiresIn === null) throw new Error('Incomplete Claude token refresh payload');
  const refreshToken = stringValue(payload.refresh_token) ?? auth.refreshToken;
  auth.oauth.accessToken = accessToken;
  auth.oauth.refreshToken = refreshToken;
  auth.oauth.expiresAt = deps.nowMs() + expiresIn * 1000;
  await deps.writeText(auth.path, JSON.stringify(auth.raw, null, 2));
  return { ...auth, accessToken, refreshToken, expiresAtMs: numberValue(auth.oauth.expiresAt) };
}

async function fetchClaude(deps: FetchDeps): Promise<ProviderUsage> {
  const auth = await maybeRefreshClaude(deps, await loadClaudeAuth(deps));
  const body = await fetchJson(deps, 'https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${auth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json', 'User-Agent': 'smalltv-ai-usage' },
  });
  return parseClaudeOAuthUsage(body, secondsNow(deps));
}

export function createAiUsageFetcher(deps: FetchDeps = defaultDeps, options: { ttlMs?: number } = {}) {
  const ttlMs = options.ttlMs ?? 60_000;
  const cache = new Map<Provider, { savedAtMs: number; value: ProviderUsage }>();

  async function fetchProvider(provider: Provider): Promise<ProviderUsage> {
    const cached = cache.get(provider);
    if (cached && deps.nowMs() - cached.savedAtMs < ttlMs) return cached.value;
    try {
      const value = provider === 'codex' ? await fetchCodex(deps) : await fetchClaude(deps);
      cache.set(provider, { savedAtMs: deps.nowMs(), value });
      return value;
    } catch (error) {
      if (cached) return staleCopy(cached.value, error);
      throw error;
    }
  }

  return { fetchProvider };
}

export const defaultAiUsageFetcher = createAiUsageFetcher();
```

- [ ] **Step 4: Run client tests to green**

Run:

```bash
npm run test -- test/ai-usage.test.ts
```

Expected: PASS for parser and client tests.

- [ ] **Step 5: Commit Task 2**

```bash
git add plugins/ai-usage/clients.ts test/ai-usage.test.ts
git commit -m "feat: add AI usage provider clients"
```

---

### Task 3: Add HTML Renderer and Plugin Wiring

**Files:**
- Create: `plugins/ai-usage/render.ts`
- Modify: `plugins/ai-usage/index.ts`
- Modify: `test/ai-usage.test.ts`

- [ ] **Step 1: Add failing renderer tests**

Append to `test/ai-usage.test.ts`:

```ts
import { renderAiUsage } from '../plugins/ai-usage/render.js';
import type { ProviderUsage } from '../plugins/ai-usage/types.js';

const claudeUsage: ProviderUsage = {
  provider: 'claude',
  label: 'Claude',
  session: { usedPercent: 33, resetAt: 1_780_157_600, windowSeconds: 18_000 },
  weekly: { usedPercent: 75, resetAt: 1_780_577_600, windowSeconds: 604_800 },
  status: 'ok',
  fetchedAt: 1_780_000_000,
};

const codexUsage = parseCodexUsage(codexPayload, 1_780_000_000);

describe('ai-usage renderer', () => {
  it('renders a single provider with 5h and 7d panels', () => {
    const html = renderAiUsage({ title: 'Claude Usage', mode: 'single', providers: ['claude'], showCredits: true, showReview: true, theme: 'dark' }, [claudeUsage], 1_780_000_000);
    expect(html).toContain('Claude Usage');
    expect(html).toContain('5h');
    expect(html).toContain('7d');
    expect(html).toContain('33%');
    expect(html).toContain('75%');
  });

  it('renders two providers compactly on one screen', () => {
    const html = renderAiUsage({ title: 'AI Usage', mode: 'auto', providers: ['claude', 'codex'], showCredits: true, showReview: true, theme: 'dark' }, [claudeUsage, codexUsage], 1_780_000_000);
    expect(html).toContain('AI Usage');
    expect(html).toContain('Claude');
    expect(html).toContain('Codex');
    expect(html).toContain('5h 33%');
    expect(html).toContain('7d 69%');
    expect(html).toContain('credits');
  });

  it('renders an error card when no usage is available', () => {
    const html = renderAiUsage({ title: 'AI Usage', mode: 'single', providers: ['codex'], showCredits: true, showReview: true, theme: 'dark' }, [{ provider: 'codex', label: 'Codex', session: null, weekly: null, status: 'error', fetchedAt: null, error: 'Codex login missing' }], 1_780_000_000);
    expect(html).toContain('Codex login missing');
  });
});
```

- [ ] **Step 2: Run renderer tests to verify they fail**

Run:

```bash
npm run test -- test/ai-usage.test.ts
```

Expected: FAIL because `plugins/ai-usage/render.ts` does not exist.

- [ ] **Step 3: Implement renderer**

Create `plugins/ai-usage/render.ts`:

```ts
import type { AiUsageConfig, ProviderUsage, UsageWindow } from './types.js';
import { formatCountdown, severityFor } from './parsers.js';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function color(percent: number): string {
  const severity = severityFor(percent);
  if (severity === 'critical') return '#c0392b';
  if (severity === 'mid') return '#d97757';
  return '#78905d';
}

function bar(window: UsageWindow | null): string {
  if (!window) return '<div class="bar"><div class="fill" style="width:0;background:#555"></div></div>';
  const width = Math.max(4, Math.min(100, window.usedPercent));
  return `<div class="bar"><div class="fill" style="width:${width}%;background:${color(window.usedPercent)}"></div></div>`;
}

function statusLine(usages: ProviderUsage[]): string {
  const stale = usages.some((usage) => usage.status === 'stale');
  const error = usages.some((usage) => usage.status === 'error');
  const fetchedAt = Math.max(...usages.map((usage) => usage.fetchedAt ?? 0));
  const date = fetchedAt > 0 ? new Date(fetchedAt * 1000) : null;
  const at = date ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '--:--';
  return `${error ? 'error' : stale ? 'stale' : 'ok'} @ ${at}`;
}

function panel(label: string, window: UsageWindow | null, nowSeconds: number): string {
  if (!window) {
    return `<section class="panel"><div class="row"><span>${esc(label)}</span><strong>—</strong></div>${bar(null)}</section>`;
  }
  return `<section class="panel"><div class="row"><span>${esc(label)}</span><strong>${window.usedPercent}%</strong><em>${esc(formatCountdown(window.resetAt, nowSeconds))}</em></div>${bar(window)}</section>`;
}

function singleProvider(title: string, usage: ProviderUsage, config: AiUsageConfig, nowSeconds: number): string {
  if (usage.status === 'error' && !usage.session && !usage.weekly) {
    return `<h1>${esc(title)}</h1><section class="panel error"><strong>${esc(usage.label)}</strong><p>${esc(usage.error ?? 'usage unavailable')}</p></section><footer>${esc(statusLine([usage]))}</footer>`;
  }
  const extras = usage.provider === 'codex'
    ? [config.showReview && usage.review ? `review ${usage.review.usedPercent}%` : '', config.showCredits && usage.credits?.balance !== undefined ? `credits ${usage.credits.balance}` : ''].filter(Boolean).join(' · ')
    : '';
  return `<h1>${esc(title)}</h1>${panel('5h', usage.session, nowSeconds)}${panel('7d', usage.weekly, nowSeconds)}${extras ? `<div class="extras">${esc(extras)}</div>` : ''}<footer>${esc(statusLine([usage]))}</footer>`;
}

function mini(label: string, window: UsageWindow | null): string {
  const pct = window?.usedPercent ?? 0;
  return `<div class="mini"><span>${esc(label)} ${window ? `${pct}%` : '—'}</span>${bar(window)}</div>`;
}

function dualProvider(title: string, usages: ProviderUsage[], config: AiUsageConfig): string {
  const blocks = usages.map((usage) => {
    const extras = usage.provider === 'codex'
      ? [config.showReview && usage.review ? `review ${usage.review.usedPercent}%` : '', config.showCredits && usage.credits?.balance !== undefined ? `credits ${usage.credits.balance}` : ''].filter(Boolean).join(' · ')
      : '';
    const body = usage.status === 'error' && !usage.session && !usage.weekly
      ? `<p class="err">${esc(usage.error ?? 'usage unavailable')}</p>`
      : `${mini('5h', usage.session)}${mini('7d', usage.weekly)}${extras ? `<small>${esc(extras)}</small>` : ''}`;
    return `<section class="provider"><h2>${esc(usage.label)}</h2>${body}</section>`;
  }).join('');
  return `<h1>${esc(title)}</h1>${blocks}<footer>${esc(statusLine(usages))}</footer>`;
}

export function renderAiUsage(config: AiUsageConfig, usages: ProviderUsage[], nowSeconds: number): string {
  const layout = config.mode === 'auto' ? (usages.length === 1 ? 'single' : 'both') : config.mode;
  const title = config.title || 'AI Usage';
  const body = layout === 'single'
    ? singleProvider(title, usages[0]!, config, nowSeconds)
    : dualProvider(title, usages, config);
  return `<!doctype html><html><head><style>
    body{margin:0;background:#000;color:#faf9f5;font-family:Arial,sans-serif;width:240px;height:240px;overflow:hidden;box-sizing:border-box;padding:8px;position:relative}
    h1{font-size:22px;margin:0 0 6px;text-align:center;font-weight:700}
    h2{font-size:16px;margin:0 0 4px;color:#faf9f5}
    .panel,.provider{background:#1f1f1e;border-radius:6px;padding:8px;margin:6px 0}
    .panel{height:58px}.provider{height:78px}
    .row{display:flex;align-items:baseline;gap:6px}.row span{font-size:14px;color:#b0aea5}.row strong{font-size:28px}.row em{font-size:13px;color:#b0aea5;font-style:normal;margin-left:auto}
    .bar{height:8px;background:#2a2a28;border-radius:5px;overflow:hidden;margin-top:8px}.fill{height:100%;border-radius:5px;min-width:4px}
    .mini{font-size:12px;margin:4px 0}.mini span{display:block;margin-bottom:2px;color:#faf9f5}.mini .bar{height:5px;margin-top:0}
    .extras,small{display:block;text-align:center;font-size:12px;color:#d97757;margin-top:4px}
    .error p,.err{font-size:13px;color:#d97757;margin:8px 0 0;line-height:1.2}
    footer{position:absolute;left:8px;right:8px;bottom:5px;text-align:center;font-size:12px;color:#d97757}
  </style></head><body>${body}</body></html>`;
}
```

- [ ] **Step 4: Wire real plugin render to clients**

Replace `plugins/ai-usage/index.ts` with:

```ts
import type { PluginManifest, RenderFn } from '../../src/plugins/types.js';
import { createAiUsageFetcher } from './clients.js';
import { aiUsageConfigSchema } from './parsers.js';
import { renderAiUsage } from './render.js';
import type { ProviderUsage } from './types.js';

const fetcher = createAiUsageFetcher();

export const manifest: PluginManifest = {
  id: 'ai-usage',
  name: 'AI Usage',
  defaultDisplayDurationMs: 15_000,
  rerenderIntervalMs: 60_000,
  configSchema: aiUsageConfigSchema,
  configFields: [
    { key: 'title', label: 'Title', type: 'string', default: 'AI Usage' },
    { key: 'mode', label: 'Layout mode', type: 'select', default: 'auto', options: [
      { value: 'auto', label: 'Auto' },
      { value: 'single', label: 'Single provider' },
      { value: 'both', label: 'Both providers' },
    ] },
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
      const usage = await fetcher.fetchProvider(provider);
      if (usage.status === 'stale') ctx.log.warn(`${usage.label} usage is stale`, { error: usage.error });
      usages.push(usage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.log.warn(`${provider} usage unavailable`, { error: message });
      usages.push({ provider, label: provider === 'codex' ? 'Codex' : 'Claude', session: null, weekly: null, status: 'error', fetchedAt: null, error: message });
    }
  }
  return renderAiUsage(cfg, usages, Math.floor(ctx.now.getTime() / 1000));
};
```

- [ ] **Step 5: Run renderer/plugin tests to green**

Run:

```bash
npm run test -- test/ai-usage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add plugins/ai-usage/render.ts plugins/ai-usage/index.ts test/ai-usage.test.ts
git commit -m "feat: render AI usage dashboard"
```

---

### Task 4: Built-In Plugin Integration and Documentation

**Files:**
- Modify: `test/loader.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add failing loader expectation**

Modify `test/loader.test.ts` built-in ids assertion to include `ai-usage`:

```ts
expect(ids).toEqual(['ai-usage', 'api-value', 'clock', 'prometheus']);
```

- [ ] **Step 2: Run loader test to verify built-in discovery**

Run:

```bash
npm run test -- test/loader.test.ts
```

Expected: PASS if plugin manifest, example config, and config schema are valid. If it fails, fix the exact validation error before editing docs.

- [ ] **Step 3: Update README built-in plugin docs**

In `README.md`, add `ai-usage` to the built-in plugin list near the existing `clock`, `api-value`, and `prometheus` entries:

```md
- **ai-usage** — shows Claude Code and/or OpenAI Codex subscription quota usage on a 240×240 dashboard. It reads local CLI OAuth credentials (`~/.claude/.credentials.json` and/or `~/.codex/auth.json`), keeps tokens out of `config/config.json`, and displays 5h + 7d usage windows with stale/error fallbacks.
```

Also add an example config block:

```json
{
  "providers": ["claude", "codex"],
  "title": "AI Usage",
  "mode": "auto",
  "showCredits": true,
  "showReview": true,
  "theme": "dark"
}
```

- [ ] **Step 4: Run focused tests after docs update**

Run:

```bash
npm run test -- test/ai-usage.test.ts test/loader.test.ts
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add test/loader.test.ts README.md
git commit -m "docs: document AI usage plugin"
```

---

### Task 5: Final Verification

**Files:**
- No new files unless preceding verification exposes a defect.

- [ ] **Step 1: Run targeted plugin and loader tests**

Run:

```bash
npm run test -- test/ai-usage.test.ts test/loader.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite only after targeted checks pass**

Run:

```bash
npm run test
```

Expected: PASS. Browser-dependent tests may skip through the existing Chromium availability gate; do not force Chromium installation inside this plan.

- [ ] **Step 4: Final commit if verification fixes were needed**

If Step 1–3 required fixes, commit the fixes:

```bash
git add plugins/ai-usage test README.md
git commit -m "fix: stabilize AI usage plugin"
```

If no fixes were needed, do not create an empty commit.
