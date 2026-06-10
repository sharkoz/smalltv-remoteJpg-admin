import { z } from 'zod';
import type { AiUsageConfig, ProviderUsage, Severity, UsageWindow } from './types.js';

const providerSchema = z.enum(['claude', 'codex']);

const providersSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.split(/[\s,]+/).filter(Boolean) : value),
  z.array(providerSchema).min(1).max(2).default(['claude', 'codex']),
);

export const aiUsageConfigSchema = z
  .object({
    providers: providersSchema,
    title: z.string().default('AI Usage'),
    mode: z.enum(['auto', 'single', 'both']).default('auto'),
    showCredits: z.boolean().default(true),
    showReview: z.boolean().default(true),
    theme: z.literal('dark').default('dark'),
  })
  .superRefine((cfg, ctx) => {
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

function valueAt(root: unknown, ...path: string[]): unknown {
  let current = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function stringAt(root: unknown, ...path: string[]): string | null {
  const value = valueAt(root, ...path);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberAt(root: unknown, ...path: string[]): number | null {
  const value = valueAt(root, ...path);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberPairAt(root: unknown, key: string): [number, number] | undefined {
  const value = valueAt(root, key);
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const first = value[0];
  const second = value[1];
  if (typeof first !== 'number' || !Number.isFinite(first) || typeof second !== 'number' || !Number.isFinite(second)) return undefined;
  return [first, second];
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
    resetAt: parsedReset !== null && Number.isFinite(parsedReset) ? parsedReset : null,
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
  return raw
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
}

export function parseCodexUsage(raw: unknown, nowSeconds: number): ProviderUsage {
  const session = parseWindow(recordAt(raw, 'rate_limit', 'primary_window'), 18_000);
  const weekly = parseWindow(recordAt(raw, 'rate_limit', 'secondary_window'), 604_800);
  if (!session || !weekly) throw new Error('Codex usage payload missing primary or secondary rate-limit window');

  const credits = recordAt(raw, 'credits');
  return {
    provider: 'codex',
    label: 'Codex',
    planLabel: formatPlanLabel(stringAt(raw, 'plan_type')),
    session,
    weekly,
    review: parseWindow(recordAt(raw, 'code_review_rate_limit', 'primary_window'), 604_800),
    credits: credits
      ? {
          balance: numberAt(credits, 'balance') ?? stringAt(credits, 'balance') ?? undefined,
          localMessages: numberPairAt(credits, 'approx_local_messages'),
          cloudMessages: numberPairAt(credits, 'approx_cloud_messages'),
        }
      : null,
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
