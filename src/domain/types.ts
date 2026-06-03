/**
 * Domain model persisted in config.json. These are plain data — no behavior.
 * Validated by src/config/schema.ts.
 */

/** One slot in a device's rotation: which dashboard, shown for how long. */
export interface DashboardAssignment {
  dashboardId: string;
  /** Override the dashboard's display duration for this device. */
  displayDurationMs: number;
}

/** A physical SmallTV unit that polls GET /devices/:id/screen.jpg. */
export interface Device {
  id: string;
  name: string;
  /** Optional device-level theme, overridden by dashboard.theme. */
  theme?: string;
  /**
   * The device's polling interval (advisory). Used to warn when a rotation
   * slot is shorter than the poll interval, which would skip dashboards.
   */
  pollIntervalMs: number;
  /** Ordered rotation. */
  assignments: DashboardAssignment[];
}

/** An instance of a plugin with its configuration. Renders to one 240x240 JPG. */
export interface Dashboard {
  id: string;
  /** References a PluginManifest.id. */
  pluginId: string;
  name: string;
  /** Per-dashboard config, validated against the plugin's configSchema. */
  config: Record<string, unknown>;
  /** Optional dashboard-level theme override. */
  theme?: string;
  /** Default dwell time when an assignment doesn't override it. */
  displayDurationMs: number;
}

/** The whole persisted configuration. */
export interface AppConfig {
  version: 1;
  devices: Device[];
  dashboards: Dashboard[];
}
