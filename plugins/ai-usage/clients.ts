import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseClaudeOAuthUsage, parseCodexUsage } from './parsers.js';
import type { FetchDeps, Provider, ProviderUsage } from './types.js';

const DEFAULT_CACHE_TTL_MS = 60_000;
const REFRESH_SKEW_MS = 300_000;
const CODEX_ACCESS_TOKEN_TTL_MS = 3_600_000;
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api';
const CODEX_REFRESH_URL = 'https://auth.openai.com/oauth/token';
const CLAUDE_REFRESH_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const USER_AGENT = 'smalltv-screens-ai-usage/0.1';

interface CachedUsage {
  expiresAtMs: number;
  usage: ProviderUsage;
}

export interface AiUsageFetcher {
  fetch(provider: Provider): Promise<ProviderUsage>;
}

interface AiUsageFetcherOptions {
  ttlMs?: number;
}

interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringAt(root: Record<string, unknown>, key: string): string | undefined {
  const value = root[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberAt(root: Record<string, unknown>, key: string): number | undefined {
  const value = root[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function expiryMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value > 10_000_000_000 ? value : value * 1000;
}

function dateMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isExpiring(token: OAuthTokenSet, nowMs: number): boolean {
  return token.expiresAtMs !== undefined && token.expiresAtMs <= nowMs + REFRESH_SKEW_MS;
}

function isExpired(token: OAuthTokenSet, nowMs: number): boolean {
  return token.expiresAtMs !== undefined && token.expiresAtMs <= nowMs;
}

function parseJson(text: string, path: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  const record = asRecord(parsed);
  if (!record) throw new Error(`${path} must contain a JSON object`);
  return record;
}

function parseCodexToken(auth: Record<string, unknown>): OAuthTokenSet {
  const tokens = asRecord(auth.tokens) ?? auth;
  const accessToken = stringAt(tokens, 'access_token') ?? stringAt(tokens, 'accessToken');
  if (!accessToken) throw new Error('Codex auth.json missing access token');
  const explicitExpiresAtMs = expiryMs(numberAt(tokens, 'expires_at') ?? numberAt(tokens, 'expiresAt'));
  const lastRefreshMs = dateMs(stringAt(auth, 'last_refresh') ?? stringAt(tokens, 'last_refresh'));
  return {
    accessToken,
    refreshToken: stringAt(tokens, 'refresh_token') ?? stringAt(tokens, 'refreshToken'),
    expiresAtMs: explicitExpiresAtMs ?? (lastRefreshMs === undefined ? undefined : lastRefreshMs + CODEX_ACCESS_TOKEN_TTL_MS),
  };
}

function parseClaudeToken(credentials: Record<string, unknown>): OAuthTokenSet {
  const oauth = asRecord(credentials.claudeAiOauth);
  if (!oauth) throw new Error('Claude credentials missing claudeAiOauth');
  const accessToken = stringAt(oauth, 'accessToken') ?? stringAt(oauth, 'access_token');
  if (!accessToken) throw new Error('Claude credentials missing access token');
  return {
    accessToken,
    refreshToken: stringAt(oauth, 'refreshToken') ?? stringAt(oauth, 'refresh_token'),
    expiresAtMs: expiryMs(numberAt(oauth, 'expiresAt') ?? numberAt(oauth, 'expires_at')),
  };
}

function setCodexToken(auth: Record<string, unknown>, token: OAuthTokenSet, nowMs: number): void {
  const tokens = asRecord(auth.tokens) ?? auth;
  tokens.access_token = token.accessToken;
  if (token.refreshToken) tokens.refresh_token = token.refreshToken;
  if (token.expiresAtMs !== undefined && (tokens.expires_at !== undefined || tokens.expiresAt !== undefined)) {
    tokens.expires_at = Math.floor(token.expiresAtMs / 1000);
  }
  auth.last_refresh = new Date(nowMs).toISOString();
  if (!auth.tokens) return;
  auth.tokens = tokens;
}

function setClaudeToken(credentials: Record<string, unknown>, token: OAuthTokenSet): void {
  const oauth = asRecord(credentials.claudeAiOauth) ?? {};
  oauth.accessToken = token.accessToken;
  if (token.refreshToken) oauth.refreshToken = token.refreshToken;
  if (token.expiresAtMs !== undefined) oauth.expiresAt = token.expiresAtMs;
  credentials.claudeAiOauth = oauth;
}

async function parseResponseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`);
  return response.json();
}

async function refreshToken(deps: FetchDeps, url: string, refreshTokenValue: string, clientId?: string): Promise<OAuthTokenSet> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshTokenValue });
  if (clientId) body.set('client_id', clientId);
  const response = await deps.fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body,
  });
  const raw = asRecord(await parseResponseJson(response, 'OAuth refresh'));
  if (!raw) throw new Error('OAuth refresh response must be a JSON object');
  const accessToken = stringAt(raw, 'access_token') ?? stringAt(raw, 'accessToken');
  if (!accessToken) throw new Error('OAuth refresh response missing access token');
  const expiresIn = numberAt(raw, 'expires_in') ?? numberAt(raw, 'expiresIn');
  return {
    accessToken,
    refreshToken: stringAt(raw, 'refresh_token') ?? stringAt(raw, 'refreshToken') ?? refreshTokenValue,
    expiresAtMs: expiresIn === undefined ? undefined : deps.nowMs() + expiresIn * 1000,
  };
}

function codexAccountId(auth: Record<string, unknown>): string | undefined {
  const tokens = asRecord(auth.tokens);
  return (
    (tokens ? stringAt(tokens, 'account_id') : undefined) ??
    stringAt(auth, 'last_active_account_id') ??
    stringAt(auth, 'chatgpt_account_id') ??
    stringAt(auth, 'account_id')
  );
}

function parseCodexBaseUrl(configToml: string): string {
  const match = /^\s*chatgpt_base_url\s*=\s*["']([^"']+)["']/m.exec(configToml);
  return match?.[1]?.replace(/\/+$/, '') ?? CODEX_DEFAULT_BASE_URL;
}

function codexUsagePath(baseUrl: string): string {
  return baseUrl.includes('/backend-api') ? '/wham/usage' : '/api/codex/usage';
}

async function readOptionalCodexConfig(deps: FetchDeps): Promise<string> {
  try {
    return await deps.readText(join(deps.homeDir(), '.codex', 'config.toml'));
  } catch {
    return '';
  }
}

async function fetchCodexUsage(deps: FetchDeps): Promise<ProviderUsage> {
  const authPath = join(deps.homeDir(), '.codex', 'auth.json');
  const auth = parseJson(await deps.readText(authPath), authPath);
  let token = parseCodexToken(auth);
  if (isExpiring(token, deps.nowMs())) {
    if (!token.refreshToken) {
      if (isExpired(token, deps.nowMs())) throw new Error('Codex access token is expired and no refresh token is available');
    } else {
      let refreshed = false;
      try {
        token = await refreshToken(deps, CODEX_REFRESH_URL, token.refreshToken, CODEX_CLIENT_ID);
        refreshed = true;
      } catch (error) {
        if (isExpired(token, deps.nowMs())) throw error;
      }
      if (refreshed) {
        setCodexToken(auth, token, deps.nowMs());
        await deps.writeText(authPath, JSON.stringify(auth, null, 2));
      }
    }
  }

  const baseUrl = parseCodexBaseUrl(await readOptionalCodexConfig(deps));
  const usagePath = codexUsagePath(baseUrl);
  const headers: Record<string, string> = { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json', 'User-Agent': USER_AGENT };
  const accountId = codexAccountId(auth);
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;
  const response = await deps.fetch(`${baseUrl}${usagePath}`, { headers });
  return parseCodexUsage(await parseResponseJson(response, 'Codex usage'), Math.floor(deps.nowMs() / 1000));
}

async function fetchClaudeUsage(deps: FetchDeps): Promise<ProviderUsage> {
  const credentialsPath = join(deps.homeDir(), '.claude', '.credentials.json');
  const credentials = parseJson(await deps.readText(credentialsPath), credentialsPath);
  let token = parseClaudeToken(credentials);
  if (isExpiring(token, deps.nowMs())) {
    if (!token.refreshToken) {
      if (isExpired(token, deps.nowMs())) throw new Error('Claude access token is expired and no refresh token is available');
    } else {
      let refreshed = false;
      try {
        token = await refreshToken(deps, CLAUDE_REFRESH_URL, token.refreshToken, CLAUDE_CLIENT_ID);
        refreshed = true;
      } catch (error) {
        if (isExpired(token, deps.nowMs())) throw error;
      }
      if (refreshed) {
        setClaudeToken(credentials, token);
        await deps.writeText(credentialsPath, JSON.stringify(credentials, null, 2));
      }
    }
  }

  const response = await deps.fetch(CLAUDE_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      'anthropic-beta': 'oauth-2025-04-20',
    },
  });
  return parseClaudeOAuthUsage(await parseResponseJson(response, 'Claude usage'), Math.floor(deps.nowMs() / 1000));
}

function staleCopy(usage: ProviderUsage, error: unknown): ProviderUsage {
  const message = error instanceof Error ? error.message : String(error);
  return { ...usage, status: 'stale', error: message };
}

export function createAiUsageFetcher(deps: FetchDeps, options: AiUsageFetcherOptions = {}): AiUsageFetcher {
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache = new Map<Provider, CachedUsage>();

  return {
    async fetch(provider) {
      const cached = cache.get(provider);
      const nowMs = deps.nowMs();
      if (cached && cached.expiresAtMs > nowMs) return cached.usage;

      try {
        const usage = provider === 'codex' ? await fetchCodexUsage(deps) : await fetchClaudeUsage(deps);
        cache.set(provider, { usage, expiresAtMs: deps.nowMs() + ttlMs });
        return usage;
      } catch (error) {
        if (cached) return staleCopy(cached.usage, error);
        throw error;
      }
    },
  };
}

export const defaultAiUsageFetcher = createAiUsageFetcher({
  nowMs: () => Date.now(),
  readText: (path) => readFile(path, 'utf8'),
  writeText: (path, value) => writeFile(path, value, 'utf8'),
  fetch: (input, init) => fetch(input, init),
  homeDir: () => homedir(),
});
