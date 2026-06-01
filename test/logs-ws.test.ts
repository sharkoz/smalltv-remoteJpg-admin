import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/http/server.js';
import { Engine } from '../src/app/engine.js';
import { ConfigStore } from '../src/config/store.js';
import { PluginRegistry } from '../src/plugins/registry.js';
import { DataCache } from '../src/datasource/cache.js';
import { ImageCache } from '../src/render/imageCache.js';
import { SecretStore } from '../src/config/secrets.js';
import { FakeClock } from '../src/util/time.js';
import { AuthService } from '../src/auth/service.js';
import { hashPassword } from '../src/auth/password.js';
import type { RendererLike } from '../src/render/renderer.js';
import type { Fetcher, FetchOutcome } from '../src/datasource/types.js';
import type { ResolvedAuthConfig } from '../src/auth/schema.js';

class FakeRenderer implements RendererLike {
  async renderHtmlToJpg(): Promise<Buffer> { return Buffer.from('x'); }
}
class NullFetcher implements Fetcher {
  async fetch(): Promise<FetchOutcome> { return { ok: false, error: 'offline' }; }
}

const authConfig: ResolvedAuthConfig = {
  sessionSecret: 'ws-secret', sessionTtlMs: 3_600_000, cookieSecure: false,
  users: [{ username: 'admin', passwordHash: hashPassword('pw') }], oauth2: undefined,
};

let dir: string;
let app: FastifyInstance;
let engine: Engine;
let wsUrl: string;
let cookie: string;

type Msg = { type: string; entries?: Array<{ message: string }>; entry?: { message: string } };

/** Attach a message collector immediately so no message is missed before listeners are set. */
function collect(ws: WebSocket): () => Promise<Msg> {
  const queue: Msg[] = [];
  const waiters: Array<(m: Msg) => void> = [];
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString()) as Msg;
    const w = waiters.shift();
    if (w) w(m); else queue.push(m);
  });
  return () =>
    new Promise<Msg>((resolve, reject) => {
      const queued = queue.shift();
      if (queued) return resolve(queued);
      const t = setTimeout(() => reject(new Error('timeout waiting for message')), 3000);
      waiters.push((m) => { clearTimeout(t); resolve(m); });
    });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stv-ws-'));
  const store = ConfigStore.load(join(dir, 'config.json'));
  const clock = new FakeClock(0);
  engine = new Engine({
    store, registry: new PluginRegistry(), dataCache: new DataCache(new NullFetcher(), clock),
    renderer: new FakeRenderer(), imageCache: new ImageCache(clock), secrets: new SecretStore(undefined), clock,
  });
  const auth = new AuthService(authConfig);
  app = buildServer({ engine, store, registry: new PluginRegistry(), auth });
  const addr = await app.listen({ port: 0, host: '127.0.0.1' });
  wsUrl = addr.replace(/^http/, 'ws') + '/admin/logs/stream';
  cookie = auth.createSessionCookie('admin').split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('logs WebSocket stream', () => {
  it('sends a backlog then pushes live entries to an authenticated client', async () => {
    engine.logs.add('info', 'test', 'seed entry', { dashboardId: 'd1' });

    const ws = new WebSocket(wsUrl, { headers: { cookie } });
    const next = collect(ws); // attach BEFORE open so the backlog isn't missed
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });

    const backlog = await next();
    expect(backlog.type).toBe('backlog');
    expect(backlog.entries!.some((e) => e.message === 'seed entry')).toBe(true);

    // A new log emitted now should arrive live.
    engine.logs.add('warn', 'datasource', 'live entry', { dashboardId: 'd1' });
    const live = await next();
    expect(live.type).toBe('entry');
    expect(live.entry!.message).toBe('live entry');

    ws.close();
  });

  it('does not stream logs to an unauthenticated client (no session cookie)', async () => {
    const ws = new WebSocket(wsUrl); // no cookie
    // It must be closed (1008) or rejected before any log message is delivered.
    const outcome = await new Promise<string>((resolve) => {
      ws.once('message', () => resolve('message'));
      ws.once('close', () => resolve('close'));
      ws.once('unexpected-response', () => resolve('rejected'));
      ws.once('error', () => resolve('error'));
    });
    expect(['close', 'rejected', 'error']).toContain(outcome);
    try { ws.close(); } catch { /* already closed */ }
  });
});
