import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/http/server.js';
import { Engine } from '../src/app/engine.js';
import { ConfigStore } from '../src/config/store.js';
import { PluginRegistry } from '../src/plugins/registry.js';
import { loadPluginsFrom } from '../src/plugins/loader.js';
import { DataCache } from '../src/datasource/cache.js';
import { ImageCache } from '../src/render/imageCache.js';
import { SecretStore } from '../src/config/secrets.js';
import { FakeClock } from '../src/util/time.js';
import { AuthService } from '../src/auth/service.js';
import { hashPassword } from '../src/auth/password.js';
import type { RendererLike } from '../src/render/renderer.js';
import type { Fetcher, FetchOutcome } from '../src/datasource/types.js';
import type { ResolvedAuthConfig } from '../src/auth/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = join(here, '..', 'plugins');

class FakeRenderer implements RendererLike {
  async renderHtmlToJpg(html: string): Promise<Buffer> { return Buffer.from(html); }
}
class NullFetcher implements Fetcher {
  async fetch(): Promise<FetchOutcome> { return { ok: false, error: 'offline' }; }
}

let dir: string;
let app: FastifyInstance;

const authConfig: ResolvedAuthConfig = {
  sessionSecret: 'test-secret',
  sessionTtlMs: 3_600_000,
  cookieSecure: false,
  users: [{ username: 'admin', passwordHash: hashPassword('pw') }],
  oauth2: undefined,
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stv-authhttp-'));
  const store = ConfigStore.load(join(dir, 'config.json'));
  store.upsertDashboard({ id: 'clock-paris', pluginId: 'clock', name: 'Paris', config: { label: 'PARIS' }, displayDurationMs: 10_000 });
  store.upsertDevice({ id: 'kitchen', name: 'Kitchen', pollIntervalMs: 2000, assignments: [{ dashboardId: 'clock-paris', displayDurationMs: 10_000 }] });

  const registry = new PluginRegistry();
  for (const p of await loadPluginsFrom(pluginsDir)) registry.register(p);
  const clock = new FakeClock(0);
  const engine = new Engine({
    store, registry, dataCache: new DataCache(new NullFetcher(), clock),
    renderer: new FakeRenderer(), imageCache: new ImageCache(clock), secrets: new SecretStore(undefined), clock,
  });
  app = buildServer({ engine, store, registry, auth: new AuthService(authConfig) });
});

afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const str = Array.isArray(raw) ? raw[0] : (raw as string);
  return str.split(';')[0]!;
}

describe('auth-protected server', () => {
  it('keeps the device poll endpoint public', async () => {
    const res = await app.inject({ method: 'GET', url: '/devices/kitchen/screen.jpg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
  });

  it('keeps /health public', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('blocks /admin API without a session (401)', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/devices' })).statusCode).toBe(401);
  });

  it('redirects /admin/ui to /login without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/ui' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('serves the login page', async () => {
    const res = await app.inject({ method: 'GET', url: '/login' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Sign in');
  });

  it('rejects bad credentials and accepts good ones, then authorizes admin calls', async () => {
    expect((await app.inject({ method: 'POST', url: '/login', payload: { username: 'admin', password: 'nope' } })).statusCode).toBe(401);

    const ok = await app.inject({ method: 'POST', url: '/login', payload: { username: 'admin', password: 'pw' } });
    expect(ok.statusCode).toBe(200);
    const cookie = cookieFrom(ok);
    expect(cookie).toContain('stv_session=');

    const devices = await app.inject({ method: 'GET', url: '/admin/devices', headers: { cookie } });
    expect(devices.statusCode).toBe(200);
    expect(devices.json()).toHaveLength(1);

    const ui = await app.inject({ method: 'GET', url: '/admin/ui', headers: { cookie } });
    expect(ui.statusCode).toBe(200);
    expect(ui.body).toContain('SmallTV Admin');
  });

  it('logout clears the cookie and redirects', async () => {
    const res = await app.inject({ method: 'GET', url: '/logout' });
    expect(res.statusCode).toBe(302);
    expect(cookieFrom(res)).toBe('stv_session=');
  });

  it('returns 404 for oauth start when oauth2 is disabled', async () => {
    expect((await app.inject({ method: 'GET', url: '/auth/oauth2/start' })).statusCode).toBe(404);
  });
});
