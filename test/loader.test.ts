import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPluginsFrom } from '../src/plugins/loader.js';
import { PluginRegistry } from '../src/plugins/registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'plugins');

describe('plugin loader', () => {
  it('loads only valid plugins and skips bad ones without crashing', async () => {
    const loaded = await loadPluginsFrom(fixtures);
    const ids = loaded.map((p) => p.manifest.id);
    expect(ids).toEqual(['good']);
  });

  it('returns empty array for a missing directory', async () => {
    const loaded = await loadPluginsFrom(join(fixtures, 'does-not-exist'));
    expect(loaded).toEqual([]);
  });

  it('loads the real built-in plugins (clock, api-value, prometheus)', async () => {
    const builtinDir = join(here, '..', 'plugins');
    const loaded = await loadPluginsFrom(builtinDir);
    const ids = loaded.map((p) => p.manifest.id).sort();
    expect(ids).toEqual(['api-value', 'clock', 'prometheus']);
  });

  it('every built-in plugin ships an exampleConfig that passes its own configSchema', async () => {
    const loaded = await loadPluginsFrom(join(here, '..', 'plugins'));
    for (const p of loaded) {
      expect(p.manifest.exampleConfig, `${p.manifest.id} should provide an exampleConfig`).toBeDefined();
      if (p.manifest.configSchema && p.manifest.exampleConfig) {
        const result = p.manifest.configSchema.safeParse(p.manifest.exampleConfig);
        expect(result.success, `${p.manifest.id} exampleConfig invalid: ${result.success ? '' : result.error.message}`).toBe(true);
      }
    }
  });
});

describe('PluginRegistry config validation', () => {
  it('validates dashboard config against the plugin configSchema', async () => {
    const loaded = await loadPluginsFrom(fixtures);
    const registry = new PluginRegistry();
    loaded.forEach((p) => registry.register(p));

    expect(registry.validateDashboardConfig('good', { n: 42 })).toEqual({ n: 42 });
    expect(() => registry.validateDashboardConfig('good', { n: 'nope' })).toThrow(/Invalid config/);
    expect(() => registry.validateDashboardConfig('missing', {})).toThrow(/Unknown plugin/);
  });
});
