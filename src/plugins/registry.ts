import type { LoadedPlugin } from './types.js';

/** In-memory map of plugin id -> loaded plugin, plus config validation helpers. */
export class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>();

  register(plugin: LoadedPlugin): void {
    this.plugins.set(plugin.manifest.id, plugin);
  }

  get(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  list(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  clear(): void {
    this.plugins.clear();
  }

  /**
   * Validate (and coerce) a dashboard's config against its plugin's configSchema.
   * Returns the validated config, or throws with a readable message. Plugins
   * without a schema accept any config object.
   */
  validateDashboardConfig(pluginId: string, config: Record<string, unknown>): Record<string, unknown> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Unknown plugin: ${pluginId}`);
    const schema = plugin.manifest.configSchema;
    if (!schema) return config;
    const result = schema.safeParse(config);
    if (!result.success) {
      throw new Error(`Invalid config for plugin ${pluginId}: ${result.error.message}`);
    }
    return result.data as Record<string, unknown>;
  }
}
