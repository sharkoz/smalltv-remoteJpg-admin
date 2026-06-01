import { describe, it, expect } from 'vitest';
import { authorizeUrl, exchangeCode, fetchUserInfo, extractEmail, isAllowed } from '../src/auth/oauth2.js';
import { oauth2Schema } from '../src/auth/schema.js';
import { AuthService } from '../src/auth/service.js';
import type { ResolvedAuthConfig } from '../src/auth/schema.js';

const cfg = oauth2Schema.parse({
  enabled: true,
  authorizationUrl: 'https://idp.example.com/authorize',
  tokenUrl: 'https://idp.example.com/token',
  userInfoUrl: 'https://idp.example.com/userinfo',
  clientId: 'client-123',
  clientSecret: 'shh',
  scopes: ['openid', 'email'],
  allowedEmails: ['alice@example.com'],
});

describe('oauth2 helpers', () => {
  it('builds an authorize URL with the expected params', () => {
    const url = new URL(authorizeUrl(cfg, { state: 'st', redirectUri: 'https://app/cb' }));
    expect(url.origin + url.pathname).toBe('https://idp.example.com/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/cb');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('state')).toBe('st');
  });

  it('extracts a nested email field', () => {
    const nested = oauth2Schema.parse({ ...cfg, emailField: 'data.email' });
    expect(extractEmail(nested, { data: { email: 'x@y.z' } })).toBe('x@y.z');
  });

  it('enforces the allowlist (deny by default)', () => {
    expect(isAllowed(cfg, 'alice@example.com')).toBe(true);
    expect(isAllowed(cfg, 'ALICE@example.com')).toBe(true); // case-insensitive
    expect(isAllowed(cfg, 'mallory@evil.com')).toBe(false);
    expect(isAllowed(cfg, undefined)).toBe(false);
  });

  it('exchanges a code and fetches userinfo via injected fetch', async () => {
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      if (url === cfg.tokenUrl) {
        expect(String(init?.body)).toContain('grant_type=authorization_code');
        return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
      }
      return new Response(JSON.stringify({ email: 'alice@example.com' }), { status: 200 });
    }) as unknown as typeof fetch;

    const token = await exchangeCode(cfg, { code: 'c', redirectUri: 'https://app/cb' }, fakeFetch);
    expect(token).toBe('tok');
    const info = await fetchUserInfo(cfg, token!, fakeFetch);
    expect(info).toEqual({ email: 'alice@example.com' });
  });
});

describe('AuthService.completeOAuth', () => {
  function service(fakeFetch: typeof fetch) {
    const config: ResolvedAuthConfig = {
      sessionSecret: 'secret', sessionTtlMs: 1000, cookieSecure: false, users: [], oauth2: cfg,
    };
    return new AuthService(config, { fetchImpl: fakeFetch });
  }

  it('returns the email for an allowed user', async () => {
    const f = (async (url: string) =>
      url === cfg.tokenUrl
        ? new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
        : new Response(JSON.stringify({ email: 'alice@example.com' }), { status: 200 })) as unknown as typeof fetch;
    expect(await service(f).completeOAuth('code', 'https://app/cb')).toBe('alice@example.com');
  });

  it('returns null for a disallowed user', async () => {
    const f = (async (url: string) =>
      url === cfg.tokenUrl
        ? new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
        : new Response(JSON.stringify({ email: 'mallory@evil.com' }), { status: 200 })) as unknown as typeof fetch;
    expect(await service(f).completeOAuth('code', 'https://app/cb')).toBeNull();
  });

  it('round-trips an oauth state token', () => {
    const f = (async () => new Response('{}')) as unknown as typeof fetch;
    const svc = service(f);
    const url = new URL(svc.oauthAuthorizeUrl('https://app/cb')!);
    expect(svc.verifyOAuthState(url.searchParams.get('state')!)).toBe(true);
    expect(svc.verifyOAuthState('forged')).toBe(false);
  });
});
