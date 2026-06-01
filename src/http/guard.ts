import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/service.js';

/**
 * Protect /admin/* (API + UI). Everything else — the device poll endpoint
 * (/devices/*), /health, /login, /auth/* — stays public, because IoT screens
 * cannot authenticate. Unauthenticated UI requests redirect to /login;
 * unauthenticated API requests get 401.
 */
export function registerAuthGuard(app: FastifyInstance, auth: AuthService): void {
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/admin')) return;
    // The WebSocket stream authenticates inside its handler — a global onRequest
    // hook that touches the reply breaks the @fastify/websocket upgrade handshake.
    if (path === '/admin/logs/stream') return;

    const session = auth.sessionFromCookieHeader(req.headers.cookie);
    if (session) {
      (req as { session?: { sub: string } }).session = session;
      return;
    }
    if (path === '/admin' || path === '/admin/ui') {
      return reply.redirect('/login');
    }
    return reply.code(401).send({ error: 'authentication required' });
  });
}
