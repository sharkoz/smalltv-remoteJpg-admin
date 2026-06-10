import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { LoadedPlugin, PluginModule } from './types.js';
import { logger } from '../util/logger.js';

const ENTRY_NAMES = ['index.ts', 'index.js', 'index.mjs'];

/** Duck-typed check that something is a Zod schema (has .safeParse). */
const zodLike = z.custom<unknown>(
  (v) => v == null || (typeof v === 'object' && typeof (v as { safeParse?: unknown }).safeParse === 'function'),
  { message: 'configSchema must be a Zod schema' },
);

const manifestShape = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  defaultDisplayDurationMs: z.number().int().positive(),
  dataSources: z
    .array(
      z.object({
        id: z.string().min(1),
        url: z.string().min(1),
        method: z.literal('GET').optional(),
        headers: z.record(z.string()).optional(),
        refreshIntervalMs: z.number().int().positive(),
        timeoutMs: z.number().int().positive().optional(),
        responseType: z.enum(['json', 'text']).optional(),
      }),
    )
    .optional(),
  configSchema: zodLike.optional(),
  configFields: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        type: z.enum(['string', 'number', 'boolean', 'select', 'text', 'color', 'location']),
        description: z.string().optional(),
        default: z.unknown().optional(),
        required: z.boolean().optional(),
        placeholder: z.string().optional(),
        options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        latKey: z.string().optional(),
        lonKey: z.string().optional(),
      }),
    )
    .optional(),
  exampleConfig: z.record(z.unknown()).optional(),
  rerenderIntervalMs: z.number().int().positive().optional(),
});

function findEntry(dir: string): string | undefined {
  for (const name of ENTRY_NAMES) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** Import one plugin directory. Returns null (after logging) on any problem.
 * `bust` appends a cache-busting query so dev hot-reload re-imports a fresh
 * module instance; leave it false for initial load (and under test runners
 * whose module resolution doesn't accept query strings). */
export async function loadPlugin(
  dir: string,
  expectedId: string,
  bust = false,
): Promise<LoadedPlugin | null> {
  const entry = findEntry(dir);
  if (!entry) {
    logger.warn('Plugin has no index entry; skipping', { dir });
    return null;
  }
  try {
    const base = pathToFileURL(entry).href;
    const url = bust ? `${base}?v=${entryMtime(entry)}` : base;
    const mod = (await import(url)) as Partial<PluginModule>;
    if (!mod.manifest || typeof mod.render !== 'function') {
      logger.warn('Plugin missing manifest or render export; skipping', { dir });
      return null;
    }
    const parsed = manifestShape.safeParse(mod.manifest);
    if (!parsed.success) {
      logger.warn('Plugin manifest invalid; skipping', { dir, error: parsed.error.message });
      return null;
    }
    if (mod.manifest.id !== expectedId) {
      logger.warn('Plugin manifest id does not match directory name; skipping', {
        dir,
        manifestId: mod.manifest.id,
        expectedId,
      });
      return null;
    }
    return { manifest: mod.manifest, render: mod.render, dir };
  } catch (err) {
    logger.warn('Failed to import plugin; skipping', { dir, error: String(err) });
    return null;
  }
}

/** Scan a directory of plugins and load each subdirectory. Bad plugins are skipped, not fatal. */
export async function loadPluginsFrom(pluginsDir: string, bust = false): Promise<LoadedPlugin[]> {
  const root = resolve(pluginsDir);
  if (!existsSync(root)) {
    logger.warn('Plugins directory does not exist', { pluginsDir: root });
    return [];
  }
  const subdirs = readdirSync(root).filter((name) => {
    try {
      return statSync(join(root, name)).isDirectory();
    } catch {
      return false;
    }
  });
  const loaded: LoadedPlugin[] = [];
  for (const name of subdirs) {
    const plugin = await loadPlugin(join(root, name), name, bust);
    if (plugin) {
      loaded.push(plugin);
      logger.info('Loaded plugin', { id: plugin.manifest.id });
    }
  }
  return loaded;
}

function entryMtime(entry: string): number {
  try {
    return statSync(entry).mtimeMs;
  } catch {
    return 0;
  }
}
