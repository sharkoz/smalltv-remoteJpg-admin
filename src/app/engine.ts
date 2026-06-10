import type { ConfigStore } from '../config/store.js';
import type { PluginRegistry } from '../plugins/registry.js';
import type { DataCache } from '../datasource/cache.js';
import type { RendererLike } from '../render/renderer.js';
import type { ImageCache } from '../render/imageCache.js';
import type { SecretStore } from '../config/secrets.js';
import { resolveTemplate } from '../config/secrets.js';
import type { Clock } from '../util/time.js';
import { systemClock } from '../util/time.js';
import type { Dashboard } from '../domain/types.js';
import type { RenderContext, LoadedPlugin } from '../plugins/types.js';
import { makeBricks, wrapFragmentIfNeeded } from '../plugins/brick.js';
import { computeCurrent, nextDashboardId, type RotationSlot } from '../rotation/scheduler.js';
import { logger } from '../util/logger.js';
import { LogStore } from '../log/logStore.js';
import { DEFAULT_THEME_NAME, getTheme, type ThemeName } from '../theme/palette.js';
import type { Device } from '../domain/types.js';

export interface EngineDeps {
  store: ConfigStore;
  registry: PluginRegistry;
  dataCache: DataCache;
  renderer: RendererLike;
  imageCache: ImageCache;
  secrets: SecretStore;
  clock?: Clock;
  /** Shared log buffer (created if omitted). Exposed as `engine.logs`. */
  logs?: LogStore;
}

export interface ScreenResult {
  dashboardId: string;
  jpg: Buffer;
}

/**
 * Ties the subsystems together: refreshes data on each source's interval,
 * pre-renders the current and next dashboard per device, and serves cached
 * JPGs to the poll endpoint. Rendering never happens on the poll path except a
 * one-time cold-start render.
 */
export class Engine {
  private readonly clock: Clock;
  private timer: NodeJS.Timeout | null = null;
  /** Shared log buffer; the HTTP layer reads from this to serve /admin/logs. */
  readonly logs: LogStore;

  constructor(private readonly deps: EngineDeps) {
    this.clock = deps.clock ?? systemClock;
    this.logs = deps.logs ?? new LogStore();
  }

  /** Rotation slots for a device, resolving each slot's display duration. */
  private slotsForDevice(deviceId: string): RotationSlot[] {
    const device = this.deps.store.getDevice(deviceId);
    if (!device) return [];
    return device.assignments.map((a) => ({
      dashboardId: a.dashboardId,
      displayDurationMs: a.displayDurationMs,
    }));
  }

  /** Build a placeholder image used when a device has no (valid) dashboard to show. */
  private async placeholder(message: string): Promise<Buffer> {
    const theme = getTheme(DEFAULT_THEME_NAME);
    const bricks = makeBricks({});
    const html = bricks.screen(bricks.text({ content: message, size: 18, color: theme.muted }), { bg: theme.bg, color: theme.text, font: theme.font });
    return this.deps.renderer.renderHtmlToJpg(html);
  }

  private themeNameFor(dashboard: Dashboard | undefined, device?: Device): ThemeName {
    return getTheme(dashboard?.theme ?? device?.theme ?? DEFAULT_THEME_NAME).name;
  }

  private imageKey(dashboardId: string, themeName: string): string {
    return `${dashboardId}::theme:${themeName}`;
  }

  /** Render one dashboard to a JPG and cache it. Returns null if the dashboard or its plugin is missing. */
  async renderDashboardNow(dashboardId: string, themeName?: ThemeName): Promise<Buffer | null> {
    const dashboard = this.deps.store.getDashboard(dashboardId);
    const resolvedThemeName = themeName ?? this.themeNameFor(dashboard);
    return this.renderDashboardWithTheme(dashboardId, resolvedThemeName, this.imageKey(dashboardId, resolvedThemeName));
  }

  private async renderDashboardWithTheme(dashboardId: string, themeName: ThemeName, cacheKey: string): Promise<Buffer | null> {
    const dashboard = this.deps.store.getDashboard(dashboardId);
    if (!dashboard) {
      logger.warn('Render requested for unknown dashboard', { dashboardId });
      return null;
    }
    const plugin = this.deps.registry.get(dashboard.pluginId);
    if (!plugin) {
      this.logs.add('error', 'render', `Unknown plugin "${dashboard.pluginId}"`, { dashboardId });
      const jpg = await this.placeholder(`Missing plugin:\n${dashboard.pluginId}`);
      this.deps.imageCache.set(cacheKey, jpg);
      return jpg;
    }

    // Fetch on demand so previews / cold-start renders show real data (and real
    // errors), not "not fetched yet" — even for dashboards no device polls yet.
    await this.ensureDataFresh(dashboardId, plugin);

    const data = this.deps.dataCache.snapshotAll(dashboardId, plugin.manifest.dataSources);
    const ctx: RenderContext = {
      dashboardId,
      config: dashboard.config,
      data,
      now: this.clock.now(),
      brick: makeBricks(data),
      theme: getTheme(themeName),
      log: this.logs.scoped('plugin', dashboardId),
    };

    let jpg: Buffer;
    try {
      const html = wrapFragmentIfNeeded(await plugin.render(ctx), ctx);
      jpg = await this.deps.renderer.renderHtmlToJpg(html);
    } catch (err) {
      this.logs.add('error', 'render', `Render failed for "${dashboard.name}"`, { dashboardId, meta: { error: String(err) } });
      jpg = await this.placeholder(`Render error:\n${dashboard.name}`);
    }
    this.deps.imageCache.set(cacheKey, jpg);
    return jpg;
  }

  /** The JPG a device should currently display. Renders on demand for a cold cache. */
  async getScreenForDevice(deviceId: string): Promise<ScreenResult | null> {
    const device = this.deps.store.getDevice(deviceId);
    if (!device) return null;

    const slots = this.slotsForDevice(deviceId);
    const { dashboardId } = computeCurrent(slots, this.clock.nowMs());
    if (!dashboardId) {
      return { dashboardId: '', jpg: await this.placeholder('No dashboards assigned') };
    }

    const dashboard = this.deps.store.getDashboard(dashboardId);
    const themeName = this.themeNameFor(dashboard, device);
    const cacheKey = this.imageKey(dashboardId, themeName);
    const cached = this.deps.imageCache.get(cacheKey);
    if (cached) return { dashboardId, jpg: cached.jpg };

    const jpg = await this.renderDashboardWithTheme(dashboardId, themeName, cacheKey);
    return { dashboardId, jpg: jpg ?? (await this.placeholder('Dashboard unavailable')) };
  }

  private resolverFor(dashboard: Dashboard) {
    return (tpl: string) =>
      resolveTemplate(tpl, { config: dashboard.config, secrets: this.deps.secrets, nowMs: this.clock.nowMs() });
  }

  /**
   * Fetch any of a dashboard's declared data sources that are due (never fetched
   * or past their refresh interval) and log the outcome. Returns true if a value
   * changed. Called both by the background tick AND on the render-on-demand path
   * (preview / cold start) so a dashboard not yet assigned to a device still gets
   * real data — otherwise its sources would read "not fetched yet" forever.
   */
  private async ensureDataFresh(dashboardId: string, plugin: LoadedPlugin): Promise<boolean> {
    const dashboard = this.deps.store.getDashboard(dashboardId);
    const decls = plugin.manifest.dataSources ?? [];
    if (!dashboard || decls.length === 0) return false;
    const resolve = this.resolverFor(dashboard);
    let changed = false;
    for (const decl of decls) {
      const snap = this.deps.dataCache.snapshot(dashboardId, decl.id);
      const due =
        !this.deps.dataCache.matchesRequest(dashboardId, decl, resolve) ||
        snap.fetchedAt == null ||
        this.clock.nowMs() - snap.fetchedAt >= decl.refreshIntervalMs;
      if (!due) continue;
      if (await this.deps.dataCache.refresh(dashboardId, decl, resolve)) changed = true;
      const after = this.deps.dataCache.snapshot(dashboardId, decl.id);
      if (after.ok) {
        this.logs.add('debug', 'datasource', `Fetched "${decl.id}"`, { dashboardId, meta: { url: decl.url } });
      } else {
        this.logs.add('warn', 'datasource', `Fetch failed for "${decl.id}": ${after.error}`, {
          dashboardId,
          meta: { url: decl.url, error: after.error },
        });
      }
    }
    return changed;
  }

  /** Dashboard ids assigned to at least one device. */
  private activeDashboardIds(): Set<string> {
    const ids = new Set<string>();
    for (const device of this.deps.store.getDevices()) {
      for (const a of device.assignments) ids.add(a.dashboardId);
    }
    return ids;
  }

  private needsRerender(dashboardId: string, cacheKey: string): boolean {
    const dashboard = this.deps.store.getDashboard(dashboardId);
    if (!dashboard) return false;
    if (!this.deps.imageCache.has(cacheKey)) return true;
    const plugin = this.deps.registry.get(dashboard.pluginId);
    const rer = plugin?.manifest.rerenderIntervalMs;
    return rer != null && this.deps.imageCache.ageMs(cacheKey) >= rer;
  }

  /**
   * One scheduler step: refresh any due data sources (invalidating rendered
   * images whose data changed), then pre-render the current and next dashboard
   * for every device so the next rotation flip is already warm.
   */
  async tick(): Promise<void> {
    const active = this.activeDashboardIds();

    // 1. Refresh due data sources for active dashboards.
    for (const dashboardId of active) {
      const dashboard = this.deps.store.getDashboard(dashboardId);
      if (!dashboard) continue;
      const plugin = this.deps.registry.get(dashboard.pluginId);
      if (!plugin) continue;
      if (await this.ensureDataFresh(dashboardId, plugin)) this.deps.imageCache.invalidate(dashboardId);
    }

    // 2. Pre-render current + next per device.
    const toRender = new Map<string, { dashboardId: string; themeName: ThemeName }>();
    for (const device of this.deps.store.getDevices()) {
      const slots = this.slotsForDevice(device.id);
      const cur = computeCurrent(slots, this.clock.nowMs()).dashboardId;
      const next = nextDashboardId(slots, this.clock.nowMs());
      for (const dashboardId of [cur, next]) {
        if (!dashboardId) continue;
        const themeName = this.themeNameFor(this.deps.store.getDashboard(dashboardId), device);
        toRender.set(this.imageKey(dashboardId, themeName), { dashboardId, themeName });
      }
    }
    for (const [cacheKey, item] of toRender) {
      if (this.needsRerender(item.dashboardId, cacheKey)) {
        await this.renderDashboardWithTheme(item.dashboardId, item.themeName, cacheKey);
      }
    }
  }

  /** Start the background scheduler. */
  start(intervalMs = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => logger.error('Engine tick failed', { error: String(err) }));
    }, intervalMs);
    // Don't keep the process alive solely for the timer in short-lived contexts.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
