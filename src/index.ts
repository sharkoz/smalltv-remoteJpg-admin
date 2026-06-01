import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import chokidar from 'chokidar';
import { ConfigStore } from './config/store.js';
import { SecretStore } from './config/secrets.js';
import { PluginRegistry } from './plugins/registry.js';
import { loadPluginsFrom, loadPlugin } from './plugins/loader.js';
import { BrowserPool } from './render/browser.js';
import { Renderer } from './render/renderer.js';
import { ImageCache } from './render/imageCache.js';
import { DataCache } from './datasource/cache.js';
import { HttpFetcher } from './datasource/fetcher.js';
import { Engine } from './app/engine.js';
import { LogStore } from './log/logStore.js';
import { buildServer } from './http/server.js';
import { loadAuthConfig } from './auth/config.js';
import { AuthService } from './auth/service.js';
import { logger } from './util/logger.js';

const here = dirname(fileURLToPath(import.meta.url));

// Resolves to <root>/plugins in dev (src/) and <root>/dist/plugins in prod (dist/src/).
const PLUGINS_DIR = process.env.PLUGINS_DIR
  ? resolve(process.env.PLUGINS_DIR)
  : resolve(here, '..', 'plugins');
const CONFIG_PATH = process.env.CONFIG_PATH
  ? resolve(process.env.CONFIG_PATH)
  : resolve(process.cwd(), 'config', 'config.json');
const SECRETS_PATH = process.env.SECRETS_PATH
  ? resolve(process.env.SECRETS_PATH)
  : resolve(process.cwd(), 'config', 'secrets.json');
const AUTH_PATH = process.env.AUTH_CONFIG_PATH
  ? resolve(process.env.AUTH_CONFIG_PATH)
  : resolve(process.cwd(), 'config', 'auth.json');

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';

async function main(): Promise<void> {
  const secrets = new SecretStore(SECRETS_PATH);
  const store = ConfigStore.load(CONFIG_PATH);

  const registry = new PluginRegistry();
  for (const plugin of await loadPluginsFrom(PLUGINS_DIR)) registry.register(plugin);
  logger.info('Plugins registered', { count: registry.list().length });

  const browser = new BrowserPool();
  const renderer = new Renderer(browser);
  const imageCache = new ImageCache();
  const dataCache = new DataCache(new HttpFetcher());

  const logs = new LogStore();
  const engine = new Engine({ store, registry, dataCache, renderer, imageCache, secrets, logs });
  engine.start();

  // Authentication for the admin API + web UI (device polling stays public).
  const loadedAuth = loadAuthConfig({ path: AUTH_PATH });
  const auth = new AuthService(loadedAuth.config);
  if (loadedAuth.generatedPassword) {
    logger.warn('No admin credentials configured — generated a temporary one', {
      username: 'admin',
      password: loadedAuth.generatedPassword,
      hint: 'Persist it with: npm run set-password -- admin <password>',
    });
  }
  if (loadedAuth.generatedSecret) {
    logger.warn('No AUTH_SESSION_SECRET set — generated an ephemeral one (sessions reset on restart).');
  }
  if (auth.oauthEnabled()) logger.info('OAuth2 sign-in enabled');

  // Dev-only plugin hot-reload.
  let watcher: chokidar.FSWatcher | undefined;
  if (!isProd) {
    // On WSL2 /mnt/c (9p) and some network/virtual mounts, inotify events don't
    // fire — set WATCH_POLLING=1 (or CHOKIDAR_USEPOLLING=true) to fall back to polling.
    const usePolling = process.env.WATCH_POLLING === '1' || process.env.CHOKIDAR_USEPOLLING === 'true';
    watcher = chokidar.watch(PLUGINS_DIR, { ignoreInitial: true, depth: 2, usePolling, interval: 400 });
    if (usePolling) logger.info('Plugin watcher using polling mode');
    const reload = async (path: string) => {
      // Plugin directory name = first path segment under PLUGINS_DIR.
      const rel = path.slice(PLUGINS_DIR.length + 1);
      const id = rel.split(/[\\/]/)[0];
      if (!id) return;
      const reloaded = await loadPlugin(join(PLUGINS_DIR, id), id, true);
      if (reloaded) {
        registry.register(reloaded);
        imageCache.invalidate(id);
        logger.info('Hot-reloaded plugin', { id });
      }
    };
    watcher.on('add', reload).on('change', reload);
  }

  const app = buildServer({ engine, store, registry, auth });
  await app.listen({ port: PORT, host: HOST });
  logger.info('Server listening', { url: `http://${HOST}:${PORT}`, adminUi: `http://${HOST}:${PORT}/admin/ui`, pluginsDir: PLUGINS_DIR, configPath: CONFIG_PATH });

  const shutdown = async (signal: string) => {
    logger.info('Shutting down', { signal });
    engine.stop();
    await watcher?.close();
    await app.close();
    await browser.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: String(err) });
  process.exit(1);
});
