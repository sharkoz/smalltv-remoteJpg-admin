import { readFileSync, existsSync } from 'node:fs';
import { logger } from '../util/logger.js';

/**
 * Resolves {{config.*}} and {{secret.*}} placeholders in data-source URLs and
 * headers. Secrets come from env (SECRET_<NAME>) first, then secrets.json.
 * Secrets are NEVER written back into config.json — only references are stored.
 */
export class SecretStore {
  private fileSecrets: Record<string, string> = {};

  constructor(secretsPath?: string) {
    if (secretsPath && existsSync(secretsPath)) {
      try {
        const parsed = JSON.parse(readFileSync(secretsPath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          this.fileSecrets = parsed as Record<string, string>;
        }
      } catch (err) {
        logger.warn('Failed to parse secrets file; ignoring', { secretsPath, err: String(err) });
      }
    }
  }

  /** Look up a secret by name. Env `SECRET_<UPPER>` wins over the file. */
  get(name: string): string | undefined {
    const envKey = `SECRET_${name.toUpperCase()}`;
    return process.env[envKey] ?? this.fileSecrets[name];
  }
}

// Captures: 1) the expression (e.g. config.url, secret.key, time.now) and
// 2) an optional filter after a pipe (e.g. {{config.query|url}}).
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*(?:\|\s*(\w+))?\s*\}\}/g;

function dig(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export interface ResolveContext {
  config: Record<string, unknown>;
  secrets: SecretStore;
  /** Current time in epoch ms, enabling the `time.*` namespace (injected by the engine). */
  nowMs?: number;
}

/** Resolve the `time.*` namespace. Returns undefined for unknown tokens. */
function resolveTime(token: string, ctx: ResolveContext): number | undefined {
  if (ctx.nowMs == null) return undefined;
  const nowS = Math.floor(ctx.nowMs / 1000);
  if (token === 'now') return nowS;
  if (token === 'nowMs') return ctx.nowMs;
  // Start of a time window: now minus config.rangeSeconds (default 1h). Used by
  // range-query plugins (e.g. Prometheus) for the `start` parameter.
  if (token === 'rangeStart') {
    const range = Number(ctx.config.rangeSeconds ?? 3600);
    return nowS - (Number.isFinite(range) ? range : 3600);
  }
  return undefined;
}

/**
 * Replace placeholders in `template`. Supports `config.*`, `secret.*` and
 * `time.*` (now / nowMs / rangeStart), plus an optional `|url` filter to
 * percent-encode the value (e.g. for a PromQL query in a URL). Unknown
 * references resolve to '' and are logged, so a misconfigured plugin degrades
 * rather than leaking `{{...}}`.
 */
export function resolveTemplate(template: string, ctx: ResolveContext): string {
  return template.replace(PLACEHOLDER, (_match, expr: string, filter: string | undefined) => {
    const parts = expr.split('.');
    const ns = parts[0];
    const rest = parts.slice(1);

    let value: unknown;
    if (ns === 'config') {
      value = dig(ctx.config, rest);
    } else if (ns === 'secret') {
      value = ctx.secrets.get(rest.join('.'));
    } else if (ns === 'time') {
      value = resolveTime(rest.join('.'), ctx);
    } else {
      logger.warn('Unknown placeholder namespace', { expr });
      return '';
    }

    if (value == null) {
      logger.warn('Unresolved placeholder', { expr });
      return '';
    }
    const str = String(value);
    return filter === 'url' ? encodeURIComponent(str) : str;
  });
}
