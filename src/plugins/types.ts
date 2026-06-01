import type { ZodTypeAny } from 'zod';

/**
 * The plugin contract. A plugin is a directory under `plugins/` exporting a
 * `manifest` and a `render` function. Everything else in the system is plumbing
 * around this seam.
 */

/** A declarative HTTP data dependency. Strings may contain {{config.*}} and {{secret.*}} placeholders. */
export interface DataSourceDecl {
  /** Unique within the plugin. Keys `RenderContext.data`. */
  id: string;
  /** Request URL. Supports {{config.x}} and {{secret.name}} placeholders. */
  url: string;
  method?: 'GET';
  /** Header values may reference secrets, e.g. { Authorization: "Bearer {{secret.openweather}}" }. */
  headers?: Record<string, string>;
  /** How often to re-fetch, independent of render cadence. */
  refreshIntervalMs: number;
  /** Per-request timeout. Default 5000. */
  timeoutMs?: number;
  /** How to parse the response body. Default 'json'. */
  responseType?: 'json' | 'text';
}

/** A choice for a `select` config field. */
export interface ConfigFieldOption {
  value: string;
  label: string;
}

/**
 * Declarative description of one config field, used to render a friendly form
 * in the admin UI (instead of raw JSON). Validation still happens via
 * `configSchema`; this is purely about presentation.
 */
export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'text' | 'color';
  /** Help text shown under the field (a plain-language tooltip). */
  description?: string;
  default?: unknown;
  required?: boolean;
  placeholder?: string;
  /** Choices for `select`. */
  options?: ConfigFieldOption[];
  /** Bounds/step for `number`. */
  min?: number;
  max?: number;
  step?: number;
}

/** The static contract a plugin declares. */
export interface PluginManifest {
  /** Stable unique id; must match the plugin directory name. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Default rotation dwell time for dashboards based on this plugin. */
  defaultDisplayDurationMs: number;
  /** Declared data dependencies. */
  dataSources?: DataSourceDecl[];
  /** Optional zod schema validating each dashboard's `config` object. */
  configSchema?: ZodTypeAny;
  /**
   * Optional declarative field descriptors. When present, the admin UI renders
   * a friendly form (typed inputs, selects, checkboxes, tooltips) instead of a
   * raw JSON editor. Field defaults seed a new dashboard's config.
   */
  configFields?: ConfigField[];
  /**
   * Optional example config shown pre-filled in the admin UI when a dashboard
   * is created with this plugin, to make configuration easier. Should be a
   * valid config (it must pass configSchema).
   */
  exampleConfig?: Record<string, unknown>;
  /**
   * Optional fixed re-render cadence in ms (e.g. a clock re-renders every 30s
   * even with no data sources). If omitted, the dashboard re-renders only when
   * a data source refreshes (or never, for fully static dashboards).
   */
  rerenderIntervalMs?: number;
}

/** Result of resolving one data source for a render. */
export interface DataResult {
  ok: boolean;
  /** Parsed body when ok. */
  value?: unknown;
  /** Error message when !ok. */
  error?: string;
  /** True when served from cache past its refresh interval (last fetch failed or is overdue). */
  stale: boolean;
  /** Epoch ms of the last successful fetch, if any. */
  fetchedAt?: number;
}

/** Logger handed to plugins so they can emit diagnostics visible in the admin UI. */
export interface PluginLogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/** Helpers for composing HTML from reusable bricks. See plugins/brick.ts. */
export interface BrickHelpers {
  /** A single line/block of text. */
  text(props: { content: string; size?: number; color?: string; weight?: number; align?: string }): string;
  /** Pull a value from a resolved data source by id and optional dotted path. */
  value(props: { source: string; path?: string; fallback?: string; size?: number; color?: string }): string;
  /** Vertical stack of children. */
  stack(children: string[], props?: { gap?: number; align?: string; justify?: string }): string;
  /** Horizontal row of children. */
  row(children: string[], props?: { gap?: number; align?: string; justify?: string }): string;
  /** The 240x240 root wrapper. Wraps children into a full document. */
  screen(children: string[] | string, props?: { bg?: string; color?: string; padding?: number; font?: string }): string;
}

/** What `render` receives at render time. */
export interface RenderContext {
  dashboardId: string;
  /** Validated per-dashboard config. */
  config: Record<string, unknown>;
  /** Resolved data keyed by DataSourceDecl.id. */
  data: Record<string, DataResult>;
  /** Injected clock — use this instead of `new Date()` so renders are testable. */
  now: Date;
  /** Brick composition helpers. */
  brick: BrickHelpers;
  /** Emit diagnostics (visible per-dashboard in the admin UI). */
  log: PluginLogger;
}

/** Returns a full HTML document string (or a fragment, wrapped by brick.screen). */
export type RenderFn = (ctx: RenderContext) => string | Promise<string>;

/** The shape a plugin module must export. */
export interface PluginModule {
  manifest: PluginManifest;
  render: RenderFn;
}

/** A plugin loaded into the registry: its module plus where it came from. */
export interface LoadedPlugin extends PluginModule {
  dir: string;
}
