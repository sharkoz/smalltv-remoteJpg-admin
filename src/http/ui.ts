import type { FastifyInstance } from 'fastify';
import { adminPage } from '../ui/adminPage.js';

/** Serve the admin SPA. The auth guard protects /admin/ui (redirects to /login). */
export function registerUi(app: FastifyInstance): void {
  app.get('/', async (_req, reply) => reply.redirect('/admin/ui'));
  app.get('/admin/ui', async (_req, reply) => reply.type('text/html').send(adminPage()));
}
