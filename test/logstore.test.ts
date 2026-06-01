import { describe, it, expect } from 'vitest';
import { LogStore } from '../src/log/logStore.js';
import { FakeClock } from '../src/util/time.js';

function store() {
  return new LogStore(5, new FakeClock(1000), false /* don't mirror to console in tests */);
}

describe('LogStore', () => {
  it('records entries newest-first with a timestamp', () => {
    const s = store();
    s.add('info', 'plugin', 'first', { dashboardId: 'd1' });
    s.add('warn', 'datasource', 'second', { dashboardId: 'd1' });
    const list = s.list();
    expect(list.map((e) => e.message)).toEqual(['second', 'first']);
    expect(list[0]!.ts).toBe(1000);
    expect(list[0]!.level).toBe('warn');
  });

  it('filters by dashboardId', () => {
    const s = store();
    s.add('info', 'plugin', 'a', { dashboardId: 'd1' });
    s.add('info', 'plugin', 'b', { dashboardId: 'd2' });
    expect(s.list({ dashboardId: 'd2' }).map((e) => e.message)).toEqual(['b']);
  });

  it('filters by minimum level', () => {
    const s = store();
    s.add('debug', 'x', 'd');
    s.add('warn', 'x', 'w');
    s.add('error', 'x', 'e');
    expect(s.list({ level: 'warn' }).map((e) => e.message)).toEqual(['e', 'w']);
  });

  it('honors the limit', () => {
    const s = store();
    s.add('info', 'x', 'a');
    s.add('info', 'x', 'b');
    expect(s.list({ limit: 1 }).map((e) => e.message)).toEqual(['b']);
  });

  it('caps the buffer at capacity (drops oldest)', () => {
    const s = store(); // capacity 5
    for (let i = 0; i < 8; i++) s.add('info', 'x', `m${i}`);
    const list = s.list();
    expect(list).toHaveLength(5);
    expect(list[0]!.message).toBe('m7'); // newest
    expect(list[4]!.message).toBe('m3'); // oldest kept
  });

  it('scoped() binds source and dashboardId', () => {
    const s = store();
    const log = s.scoped('plugin', 'd9');
    log.warn('hi', { k: 1 });
    const e = s.list()[0]!;
    expect(e).toMatchObject({ source: 'plugin', dashboardId: 'd9', level: 'warn', message: 'hi', meta: { k: 1 } });
  });
});
