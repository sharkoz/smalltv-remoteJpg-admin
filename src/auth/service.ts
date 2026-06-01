import { Signer } from './tokens.js';
import { verifyPassword } from './password.js';
import { authorizeUrl, exchangeCode, fetchUserInfo, extractEmail, isAllowed, type FetchLike } from './oauth2.js';
import type { ResolvedAuthConfig } from './schema.js';
import type { Clock } from '../util/time.js';
import { systemClock } from '../util/time.js';

const COOKIE = 'stv_session';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface Session {
  sub: string;
}

export interface AuthServiceOptions {
  clock?: Clock;
  fetchImpl?: FetchLike;
}

/** Parse a Cookie header into a name->value map. */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** Encapsulates authentication: credentials, session cookies, and the OAuth2 flow. */
export class AuthService {
  private readonly signer: Signer;
  private readonly clock: Clock;
  private readonly fetchImpl: FetchLike;

  constructor(
    public readonly config: ResolvedAuthConfig,
    opts: AuthServiceOptions = {},
  ) {
    this.clock = opts.clock ?? systemClock;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.signer = new Signer(config.sessionSecret, this.clock);
  }

  oauthEnabled(): boolean {
    return Boolean(this.config.oauth2?.enabled);
  }

  oauthButtonLabel(): string {
    return this.config.oauth2?.buttonLabel ?? 'Sign in with OAuth2';
  }

  /** Verify a username/password pair against the configured users. */
  verifyCredentials(username: string, password: string): boolean {
    const user = this.config.users.find((u) => u.username === username);
    if (!user) return false;
    return verifyPassword(password, user.passwordHash);
  }

  // --- Session cookie ---
  private cookieAttrs(maxAgeSec: number): string {
    const secure = this.config.cookieSecure ? '; Secure' : '';
    return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`;
  }

  createSessionCookie(sub: string): string {
    const token = this.signer.sign({ sub }, this.config.sessionTtlMs);
    return `${COOKIE}=${token}; ${this.cookieAttrs(Math.floor(this.config.sessionTtlMs / 1000))}`;
  }

  clearSessionCookie(): string {
    return `${COOKIE}=; ${this.cookieAttrs(0)}`;
  }

  sessionFromCookieHeader(header: string | undefined): Session | null {
    const token = parseCookies(header)[COOKIE];
    return this.signer.verify<Session>(token);
  }

  // --- OAuth2 ---
  oauthAuthorizeUrl(redirectUri: string): string | null {
    const cfg = this.config.oauth2;
    if (!cfg?.enabled) return null;
    const state = this.signer.sign({ k: 'oauth' }, OAUTH_STATE_TTL_MS);
    return authorizeUrl(cfg, { state, redirectUri });
  }

  verifyOAuthState(state: string | undefined): boolean {
    const payload = this.signer.verify<{ k?: string }>(state);
    return payload?.k === 'oauth';
  }

  /** Complete the callback: exchange code, fetch userinfo, enforce the allowlist.
   * Returns the authenticated identity (email) or null if not allowed. */
  async completeOAuth(code: string, redirectUri: string): Promise<string | null> {
    const cfg = this.config.oauth2;
    if (!cfg?.enabled) return null;
    const token = await exchangeCode(cfg, { code, redirectUri }, this.fetchImpl);
    if (!token) return null;
    const userinfo = await fetchUserInfo(cfg, token, this.fetchImpl);
    if (!userinfo) return null;
    const email = extractEmail(cfg, userinfo);
    return isAllowed(cfg, email) ? email! : null;
  }
}
