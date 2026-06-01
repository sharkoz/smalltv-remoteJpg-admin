import type { Clock } from '../util/time.js';
import { systemClock } from '../util/time.js';
import { logger } from '../util/logger.js';
import type { PluginLogger } from '../plugins/types.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  /** Origin of the log: 'plugin', 'datasource', 'render', 'engine'. */
  source: string;
  dashboardId?: string;
  message: string;
  meta?: unknown;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogQuery {
  dashboardId?: string;
  /** Minimum level to include. */
  level?: LogLevel;
  /** Max entries (newest first). */
  limit?: number;
}

/**
 * In-memory ring buffer of recent log entries, queryable by dashboard/level.
 * Also mirrors to the console logger so logs still show in stdout. Capacity-
 * bounded so it never grows unbounded.
 */
export type LogListener = (entry: LogEntry) => void;

export class LogStore {
  private buf: LogEntry[] = [];
  private listeners = new Set<LogListener>();

  constructor(
    private readonly capacity = 1000,
    private readonly clock: Clock = systemClock,
    private readonly mirrorToConsole = true,
  ) {}

  add(level: LogLevel, source: string, message: string, opts: { dashboardId?: string; meta?: unknown } = {}): void {
    const entry: LogEntry = { ts: this.clock.nowMs(), level, source, message, dashboardId: opts.dashboardId, meta: opts.meta };
    this.buf.push(entry);
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity);
    if (this.mirrorToConsole) {
      const tag = `${source}${entry.dashboardId ? ':' + entry.dashboardId : ''}`;
      logger[level](`[${tag}] ${message}`, opts.meta);
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // a broken subscriber must never break logging
      }
    }
  }

  /** Subscribe to new entries (used by the WebSocket stream). Returns an unsubscribe fn. */
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A logger bound to a source (and optional dashboard) — handed to plugins as ctx.log. */
  scoped(source: string, dashboardId?: string): PluginLogger {
    return {
      debug: (m, meta) => this.add('debug', source, m, { dashboardId, meta }),
      info: (m, meta) => this.add('info', source, m, { dashboardId, meta }),
      warn: (m, meta) => this.add('warn', source, m, { dashboardId, meta }),
      error: (m, meta) => this.add('error', source, m, { dashboardId, meta }),
    };
  }

  /** Recent entries, newest first, filtered by dashboard/level. */
  list(query: LogQuery = {}): LogEntry[] {
    let entries = this.buf;
    if (query.dashboardId) entries = entries.filter((e) => e.dashboardId === query.dashboardId);
    if (query.level) {
      const min = ORDER[query.level];
      entries = entries.filter((e) => ORDER[e.level] >= min);
    }
    const newestFirst = entries.slice().reverse();
    return query.limit ? newestFirst.slice(0, query.limit) : newestFirst;
  }

  clear(): void {
    this.buf = [];
  }
}
