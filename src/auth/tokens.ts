import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../util/time.js';
import { systemClock } from '../util/time.js';

/**
 * Stateless signed tokens: `base64url(payload).base64url(hmac)`. Used for the
 * session cookie and the OAuth2 state parameter. Tokens carry their own `exp`
 * (epoch ms); verification checks the signature (constant-time) and expiry
 * against the injected clock. No server-side store needed.
 */
export class Signer {
  constructor(
    private readonly secret: string,
    private readonly clock: Clock = systemClock,
  ) {}

  private mac(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  /** Sign a payload. Pass `ttlMs` to stamp an expiry. */
  sign(payload: Record<string, unknown>, ttlMs?: number): string {
    const withExp = ttlMs != null ? { ...payload, exp: this.clock.nowMs() + ttlMs } : payload;
    const body = Buffer.from(JSON.stringify(withExp)).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  /** Verify and decode a token. Returns null if tampered or expired. */
  verify<T = Record<string, unknown>>(token: string | undefined): T | null {
    if (!token) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = this.mac(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (typeof payload.exp === 'number' && this.clock.nowMs() > payload.exp) return null;
    return payload as T;
  }
}
