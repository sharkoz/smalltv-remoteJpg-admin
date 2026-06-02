import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { Engine } from '../app/engine.js';
import type { ConfigStore } from '../config/store.js';
import type { PluginRegistry } from '../plugins/registry.js';
import { deviceSchema, dashboardSchema } from '../config/schema.js';
import { skipWarnings } from '../rotation/scheduler.js';
import { slugify, uniqueId } from '../util/id.js';
import type { Device, Dashboard } from '../domain/types.js';
import type { LogLevel } from '../log/logStore.js';
import type { AuthService } from '../auth/service.js';
import { registerAuthGuard } from './guard.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerUi } from './ui.js';

export interface ServerDeps {
  engine: Engine;
  store: ConfigStore;
  registry: PluginRegistry;
  /** When provided, /admin/* and the web UI are protected and /login + /auth/* are added. */
  auth?: AuthService;
}

/** Ensure an entity body has an id: keep an existing one (edit), else generate a
 * unique slug from its name (create). IDs are managed server-side and hidden in the UI. */
function withId(body: unknown, existing: Array<{ id: string }>): unknown {
  const obj = (body ?? {}) as Record<string, unknown>;
  if (typeof obj.id === 'string' && obj.id.length > 0) return obj;
  const name = typeof obj.name === 'string' ? obj.name : '';
  return { ...obj, id: uniqueId(slugify(name), existing.map((e) => e.id)) };
}

/** Build the Fastify app. Use `.inject()` in tests or `.listen()` in production. */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const { engine, store, registry, auth } = deps;

  // Auth must be wired before routes so the onRequest guard runs first.
  if (auth) {
    registerAuthGuard(app, auth);
    registerAuthRoutes(app, auth);
    registerUi(app);
  }

  app.get('/health', async () => ({ status: 'ok' }));

  // --- Device poll endpoint: the only route a SmallTV hits. ---
  app.get<{ Params: { id: string } }>('/devices/:id/screen.jpg', async (req, reply) => {
    const result = await engine.getScreenForDevice(req.params.id);
    if (!result) {
      return reply.code(404).send({ error: 'unknown device' });
    }
    return reply
      .type('image/jpeg')
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .header('X-Dashboard-Id', result.dashboardId || 'none')
      .send(result.jpg);
  });

  // --- Admin / management API ---
  app.get('/admin/plugins', async () =>
    registry.list().map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      defaultDisplayDurationMs: p.manifest.defaultDisplayDurationMs,
      dataSources: (p.manifest.dataSources ?? []).map((d) => ({ id: d.id, refreshIntervalMs: d.refreshIntervalMs })),
      configFields: p.manifest.configFields ?? [],
      exampleConfig: p.manifest.exampleConfig ?? {},
    })),
  );

  app.get('/admin/devices', async () => store.getDevices());
  app.get('/admin/dashboards', async () => store.getDashboards());

  app.get('/admin/logs', async (req) => {
    const q = req.query as { dashboardId?: string; level?: string; limit?: string };
    return engine.logs.list({
      dashboardId: q.dashboardId || undefined,
      level: (q.level as LogLevel | undefined) || undefined,
      limit: q.limit ? Math.min(Number(q.limit), 1000) : 200,
    });
  });

  app.delete('/admin/logs', async () => {
    engine.logs.clear();
    return { cleared: true };
  });

  // Live log stream. Registered inside an encapsulated plugin so the websocket
  // plugin's onRoute hook is installed BEFORE the route is added (otherwise the
  // route isn't treated as a websocket and the upgrade never completes).
  app.register(async (instance) => {
    await instance.register(fastifyWebsocket);
    instance.get('/admin/logs/stream', { websocket: true }, (connection, req) => {
      // @fastify/websocket v8 passes { socket }; later majors pass the socket directly.
      const socket = (connection as { socket?: unknown }).socket ?? connection;
      const sock = socket as { send(data: string): void; close(code?: number, reason?: string): void; on(ev: string, cb: () => void): void };

      // Authenticate here (the global guard exempts this path so the upgrade can complete).
      if (auth && !auth.sessionFromCookieHeader(req.headers.cookie)) {
        try { sock.close(1008, 'unauthorized'); } catch { /* already closed */ }
        return;
      }

      const send = (payload: unknown) => {
        try {
          sock.send(JSON.stringify(payload));
        } catch {
          /* socket closed mid-send */
        }
      };
      send({ type: 'backlog', entries: engine.logs.list({ limit: 200 }).reverse() });
      const unsubscribe = engine.logs.subscribe((entry) => send({ type: 'entry', entry }));
      sock.on('close', unsubscribe);
    });
  });

  app.post('/admin/devices', async (req, reply) => {
    // IDs are hidden from the UI: generate a stable slug from the name on create.
    const body = withId(req.body, store.getDevices());
    const parsed = deviceSchema.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const device = parsed.data as Device;
    // Validate that referenced dashboards exist.
    const missing = device.assignments.filter((a) => !store.getDashboard(a.dashboardId)).map((a) => a.dashboardId);
    if (missing.length) return reply.code(400).send({ error: `unknown dashboards: ${missing.join(', ')}` });
    store.upsertDevice(device);
    return reply.code(201).send({ device, warnings: skipWarnings(
      device.assignments.map((a) => ({ dashboardId: a.dashboardId, displayDurationMs: a.displayDurationMs })),
      device.pollIntervalMs,
    ) });
  });

  app.delete<{ Params: { id: string } }>('/admin/devices/:id', async (req, reply) => {
    const removed = store.removeDevice(req.params.id);
    return reply.code(removed ? 200 : 404).send({ removed });
  });

  app.post('/admin/dashboards', async (req, reply) => {
    const body = withId(req.body, store.getDashboards());
    const parsed = dashboardSchema.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const dashboard = parsed.data as Dashboard;
    if (!registry.has(dashboard.pluginId)) {
      return reply.code(400).send({ error: `unknown plugin: ${dashboard.pluginId}` });
    }
    try {
      dashboard.config = registry.validateDashboardConfig(dashboard.pluginId, dashboard.config);
    } catch (err) {
      return reply.code(400).send({ error: String(err instanceof Error ? err.message : err) });
    }
    const previous = store.getDashboard(dashboard.id);
    store.upsertDashboard(dashboard);
    if (previous && previous.displayDurationMs !== dashboard.displayDurationMs) {
      for (const device of store.getDevices()) {
        let changed = false;
        const assignments = device.assignments.map((assignment) => {
          if (assignment.dashboardId !== dashboard.id || assignment.displayDurationMs !== previous.displayDurationMs) {
            return assignment;
          }
          changed = true;
          return { ...assignment, displayDurationMs: dashboard.displayDurationMs };
        });
        if (changed) store.upsertDevice({ ...device, assignments });
      }
    }
    return reply.code(201).send({ dashboard });
  });

  app.delete<{ Params: { id: string } }>('/admin/dashboards/:id', async (req, reply) => {
    const removed = store.removeDashboard(req.params.id);
    return reply.code(removed ? 200 : 404).send({ removed });
  });

  // On-demand single-dashboard render — bypasses rotation, for plugin authoring.
  app.get<{ Params: { id: string } }>('/admin/dashboards/:id/preview.jpg', async (req, reply) => {
    const jpg = await engine.renderDashboardNow(req.params.id);
    if (!jpg) return reply.code(404).send({ error: 'unknown dashboard' });
    return reply.type('image/jpeg').header('Cache-Control', 'no-cache').send(jpg);
  });

  return app;
}
