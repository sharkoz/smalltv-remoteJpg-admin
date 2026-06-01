/**
 * Minimal structured logger for non-HTTP modules. The Fastify server uses its
 * own pino instance; everything else uses this so logging stays dependency-free
 * and easy to silence in tests (set LOG_LEVEL=silent).
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (env === 'silent') return Number.POSITIVE_INFINITY;
  return ORDER[(env as Level)] ?? ORDER.info;
}

function emit(level: Level, msg: string, meta?: unknown): void {
  if (ORDER[level] < threshold()) return;
  const line = meta === undefined ? msg : `${msg} ${JSON.stringify(meta)}`;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(`[${level}] ${line}`);
}

export const logger = {
  debug: (msg: string, meta?: unknown) => emit('debug', msg, meta),
  info: (msg: string, meta?: unknown) => emit('info', msg, meta),
  warn: (msg: string, meta?: unknown) => emit('warn', msg, meta),
  error: (msg: string, meta?: unknown) => emit('error', msg, meta),
};
