import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.js';
import { loginPage } from '../ui/loginPage.js';

function callbackUri(req: FastifyRequest): string {
  return `${req.protocol}://${req.headers.host}/auth/oauth2/callback`;
}

/** Login page, credential login, logout, and the OAuth2 redirect dance. */
export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  app.get('/login', async (req, reply) => {
    if (auth.sessionFromCookieHeader(req.headers.cookie)) {
      return reply.redirect('/admin/ui');
    }
    const error = (req.query as { error?: string }).error;
    return reply
      .type('text/html')
      .send(loginPage({ oauthEnabled: auth.oauthEnabled(), oauthLabel: auth.oauthButtonLabel(), error }));
  });

  app.post<{ Body: { username?: string; password?: string } }>('/login', async (req, reply) => {
    const { username = '', password = '' } = req.body ?? {};
    if (!auth.verifyCredentials(username, password)) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    return reply.header('Set-Cookie', auth.createSessionCookie(username)).send({ ok: true });
  });

  app.get('/logout', async (_req, reply) => {
    return reply.header('Set-Cookie', auth.clearSessionCookie()).redirect('/login');
  });

  app.get('/auth/oauth2/start', async (req, reply) => {
    const url = auth.oauthAuthorizeUrl(callbackUri(req));
    if (!url) return reply.code(404).send({ error: 'oauth2 not enabled' });
    return reply.redirect(url);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>('/auth/oauth2/callback', async (req, reply) => {
    const { code, state } = req.query;
    if (!code || !auth.verifyOAuthState(state)) {
      return reply.redirect('/login?error=oauth');
    }
    const identity = await auth.completeOAuth(code, callbackUri(req));
    if (!identity) return reply.redirect('/login?error=oauth');
    return reply.header('Set-Cookie', auth.createSessionCookie(identity)).redirect('/admin/ui');
  });
}
