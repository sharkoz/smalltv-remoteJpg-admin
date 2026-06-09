# AI Usage Plugin Design

## Goal

Add a single SmallTV plugin, `ai-usage`, that displays Claude Code and OpenAI Codex subscription usage on a 240x240 dashboard. The plugin should support Claude only, Codex only, or both providers on one screen.

The plugin tracks quota windows that matter for coding assistants: short session usage, weekly usage, optional Codex code-review usage, and optional Codex credits. It must clearly present these as subscription/CLI-derived quota signals, not OpenAI API billing costs.

## Context

Existing SmallTV plugins live under `plugins/<id>/index.ts`, export `manifest` and `render`, use Zod `configSchema`, and render via `ctx.brick.screen(...)`. The existing declarative `dataSources` system only supports simple HTTP GETs with static/template headers. It cannot read local CLI credentials or refresh OAuth tokens. Therefore `ai-usage` needs provider-specific client code inside the plugin rather than only declarative data sources.

Reference behavior:

- `codexbar` reads `~/.codex/auth.json`, refreshes OpenAI OAuth tokens with Codex CLI client id `app_EMoamEEZ73f0CkXaXp7hrann`, and calls `https://chatgpt.com/backend-api/wham/usage`.
- `ClaudexBar` supports both Claude and Codex and normalizes their quota windows into a common payload.
- `claude-meter` shows a 240x240 two-panel layout for 5h and 7d usage, with dark cards, percent values, progress bars, reset time, and status.

## Plugin Shape

Create one plugin directory:

```text
plugins/ai-usage/index.ts
```

The plugin manifest:

- `id`: `ai-usage`
- `name`: `AI Usage`
- `defaultDisplayDurationMs`: `15_000`
- `rerenderIntervalMs`: `60_000`
- `configSchema`: validates provider/display settings
- `configFields`: typed admin UI fields
- `exampleConfig`: valid dual-provider example

## Configuration

Dashboard config fields:

```ts
type Provider = 'claude' | 'codex';

type AiUsageConfig = {
  providers: Provider[];          // one or both, default ['claude', 'codex']
  title: string;                  // default 'AI Usage'
  mode: 'auto' | 'single' | 'both';// auto chooses based on providers length
  showCredits: boolean;           // Codex credits if present
  showReview: boolean;            // Codex code-review quota if present
  theme: 'dark';                  // initially fixed, future-proofed
};
```

Validation rules:

- `providers` must contain at least one provider and no duplicates.
- `mode: 'single'` is valid only when one provider is configured; `mode: 'both'` is valid only when two providers are configured. `auto` chooses the appropriate layout.
- Defaults should keep the admin form usable without raw JSON editing.

No OAuth tokens, API keys, or credentials are stored in `config/config.json`.

## Provider Clients

Implement two internal clients behind a common shape:

```ts
type UsageWindow = {
  usedPercent: number;       // 0..100, rounded for display
  resetAt: number | null;    // Unix seconds
  windowSeconds: number | null;
};

type ProviderUsage = {
  provider: 'claude' | 'codex';
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
  status: 'ok' | 'stale' | 'error';
  fetchedAt: number | null;
  error?: string;
};
```

### Codex client

- Read `~/.codex/auth.json`.
- Support OAuth-style Codex CLI credentials under `tokens.access_token`, `tokens.refresh_token`, and optional `tokens.account_id`.
- Refresh OAuth tokens via `https://auth.openai.com/oauth/token` using the Codex CLI client id and refresh token when the access token is stale or near stale.
- Resolve base URL from `~/.codex/config.toml` when `chatgpt_base_url` is present; default to `https://chatgpt.com/backend-api`.
- Fetch usage from `/wham/usage` when using `backend-api`, otherwise `/api/codex/usage` for compatible alternate base URLs.
- Send `Authorization: Bearer <access_token>`, `Accept: application/json`, and `ChatGPT-Account-Id` when available.
- Parse:
  - `rate_limit.primary_window` as session usage
  - `rate_limit.secondary_window` as weekly usage
  - `code_review_rate_limit.primary_window` as optional review usage
  - `additional_rate_limits[]` as optional future tooltip/detail data if useful later
  - `credits` as optional credit display
  - `plan_type` as optional plan label

### Claude client

- Read `~/.claude/.credentials.json` and find `claudeAiOauth` credentials.
- Refresh OAuth tokens through `https://console.anthropic.com/v1/oauth/token` when `expiresAt` is near expiry.
- Prefer `https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <accessToken>` and `anthropic-beta: oauth-2025-04-20`.
- Parse:
  - `five_hour.utilization` and `five_hour.resets_at` as session usage
  - `seven_day.utilization` and `seven_day.resets_at` as weekly usage
- Keep a fallback parser for a minimal Anthropic `/v1/messages` response header shape:
  - `anthropic-ratelimit-unified-5h-utilization`
  - `anthropic-ratelimit-unified-5h-reset`
  - `anthropic-ratelimit-unified-7d-utilization`
  - `anthropic-ratelimit-unified-7d-reset`
  This fallback is useful if the usage endpoint changes or is unavailable, but it should not be the default if the direct usage endpoint works.

## Cache and Error Handling

The plugin should avoid making network calls during every render when data is fresh.

- Keep module-level in-memory cache per provider.
- Treat cached data as fresh for 60 seconds.
- On transient network/API failure, return last good data with `status: 'stale'` and attach the error message.
- On missing credentials and no cache, render a clear provider-specific error card, e.g. `Codex login missing` or `Claude credentials missing`.
- Never log raw access tokens, refresh tokens, account ids, Authorization headers, or credential file contents.
- Use `ctx.log.warn(...)` for stale/error states so the Admin Logs panel explains fallback behavior.

## Rendering

The visual target is a compact 240x240 screen inspired by `claude-meter`:

- black background
- dark rounded panels
- short title at the top
- large percentages
- reset countdowns
- horizontal progress bars
- green/amber/red severity colors
- bottom status line with `ok @ HH:mm` or `stale @ HH:mm`

Severity:

- `< 50%`: green
- `50–79%`: amber
- `>= 80%`: red

Layouts:

1. Single provider layout
   - Title: provider label or custom title
   - Two stacked panels: `5h` and `7d`
   - Each panel shows percent, reset countdown, and bar
   - Optional Codex credits/review as compact footer text when enabled

2. Dual provider layout
   - Title: custom title, default `AI Usage`
   - Two provider blocks: `Claude` and `Codex`
   - Each block shows compact `5h` and `7d` rows with mini bars
   - Codex review/credits appear only if enabled and if payload contains data

The plugin returns HTML through `ctx.brick.screen(...)` plus inline CSS/SVG where needed. It should not add external assets or a frontend build step.

## Important Constraints

- This feature relies on unofficial/undocumented subscription usage endpoints and CLI credential file shapes. Code should be defensive and render useful errors when shapes change.
- The plugin must not scrape ChatGPT or Anthropic browser UI.
- The plugin must not confuse Codex subscription quota with OpenAI API costs/rate-limit headers.
- The plugin must keep credentials local and out of app config.
- The implementation should stay inside plugin/helper code and avoid changing the core plugin ABI unless unavoidable.

## Testing Plan

Add focused Vitest coverage for:

- config validation: provider list, mode constraints, defaults, valid example config
- Codex payload parsing for `wham/usage`
- Codex missing fields and malformed payload errors
- Claude `oauth/usage` payload parsing
- Claude fallback header parsing
- reset countdown formatting and severity thresholds
- render output for Claude only, Codex only, and both providers
- stale data behavior: network failure with last good data returns stale usage and logs warning
- missing credentials with no cache renders a readable error card

Use local fixture JSON/headers. Do not use live OpenAI or Anthropic network calls in tests.
