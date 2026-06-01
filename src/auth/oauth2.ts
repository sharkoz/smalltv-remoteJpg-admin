import type { OAuth2Config } from './schema.js';

/** Injectable fetch so the flow can be tested without a real provider. */
export type FetchLike = typeof fetch;

/** Build the provider authorization URL to redirect the user to. */
export function authorizeUrl(cfg: OAuth2Config, opts: { state: string; redirectUri: string }): string {
  const url = new URL(cfg.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('scope', cfg.scopes.join(' '));
  url.searchParams.set('state', opts.state);
  return url.toString();
}

/** Exchange an authorization code for an access token. Returns null on failure. */
export async function exchangeCode(
  cfg: OAuth2Config,
  opts: { code: string; redirectUri: string },
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  try {
    const res = await fetchImpl(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

/** Fetch the userinfo document with the access token. */
export async function fetchUserInfo(
  cfg: OAuth2Config,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchImpl(cfg.userInfoUrl, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Read the configured identity field (dotted path) from a userinfo document. */
export function extractEmail(cfg: OAuth2Config, userinfo: Record<string, unknown>): string | undefined {
  let cur: unknown = userinfo;
  for (const key of cfg.emailField.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** An identity is allowed only if explicitly present in the allowlist (deny by default). */
export function isAllowed(cfg: OAuth2Config, email: string | undefined): boolean {
  if (!email) return false;
  return cfg.allowedEmails.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}
