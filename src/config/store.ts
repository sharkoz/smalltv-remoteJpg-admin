import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppConfig, Device, Dashboard } from '../domain/types.js';
import { appConfigSchema, EMPTY_CONFIG } from './schema.js';
import { logger } from '../util/logger.js';

/**
 * In-memory config backed by a JSON file. Loaded and validated on construction;
 * mutations are persisted with an atomic write (temp file + rename). Chosen over
 * SQLite because the data is tiny, writes are rare, and the file stays human-
 * readable/diffable for a self-hosted tool.
 */
export class ConfigStore {
  private config: AppConfig;

  private constructor(
    private readonly path: string,
    config: AppConfig,
  ) {
    this.config = config;
  }

  /** Load from disk (or start empty if the file doesn't exist). Throws on invalid JSON/shape. */
  static load(path: string): ConfigStore {
    if (!existsSync(path)) {
      logger.info('No config file found; starting with empty config', { path });
      return new ConfigStore(path, structuredClone(EMPTY_CONFIG));
    }
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    const result = appConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid config at ${path}: ${result.error.message}`);
    }
    return new ConfigStore(path, result.data as AppConfig);
  }

  /** A defensive copy of the whole config. */
  getConfig(): AppConfig {
    return structuredClone(this.config);
  }

  getDevices(): Device[] {
    return structuredClone(this.config.devices);
  }

  getDevice(id: string): Device | undefined {
    const d = this.config.devices.find((x) => x.id === id);
    return d ? structuredClone(d) : undefined;
  }

  getDashboards(): Dashboard[] {
    return structuredClone(this.config.dashboards);
  }

  getDashboard(id: string): Dashboard | undefined {
    const d = this.config.dashboards.find((x) => x.id === id);
    return d ? structuredClone(d) : undefined;
  }

  /** Insert or replace a device by id. */
  upsertDevice(device: Device): void {
    const i = this.config.devices.findIndex((d) => d.id === device.id);
    if (i >= 0) this.config.devices[i] = device;
    else this.config.devices.push(device);
    this.persist();
  }

  removeDevice(id: string): boolean {
    const before = this.config.devices.length;
    this.config.devices = this.config.devices.filter((d) => d.id !== id);
    const changed = this.config.devices.length !== before;
    if (changed) this.persist();
    return changed;
  }

  /** Insert or replace a dashboard by id. */
  upsertDashboard(dashboard: Dashboard): void {
    const i = this.config.dashboards.findIndex((d) => d.id === dashboard.id);
    if (i >= 0) this.config.dashboards[i] = dashboard;
    else this.config.dashboards.push(dashboard);
    this.persist();
  }

  removeDashboard(id: string): boolean {
    const before = this.config.dashboards.length;
    this.config.dashboards = this.config.dashboards.filter((d) => d.id !== id);
    const changed = this.config.dashboards.length !== before;
    if (changed) this.persist();
    return changed;
  }

  /** Atomic write: serialize to a temp file, then rename over the target. */
  private persist(): void {
    // Re-validate before writing so we never persist a corrupt shape.
    const validated = appConfigSchema.parse(this.config);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(validated, null, 2), 'utf8');
    renameSync(tmp, this.path);
  }
}
