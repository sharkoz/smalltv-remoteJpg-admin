import { describe, it, expect } from 'vitest';
import { computeCurrent, nextDashboardId, skipWarnings } from '../src/rotation/scheduler.js';
import type { RotationSlot } from '../src/rotation/scheduler.js';

const slots: RotationSlot[] = [
  { dashboardId: 'a', displayDurationMs: 10_000 },
  { dashboardId: 'b', displayDurationMs: 15_000 },
];
// cycle = 25_000

describe('computeCurrent', () => {
  it('returns null for an empty rotation', () => {
    expect(computeCurrent([], 1234)).toEqual({ dashboardId: null, indexInCycle: -1, msUntilNext: 0 });
  });

  it('selects the first slot at the start of the cycle', () => {
    expect(computeCurrent(slots, 0)).toMatchObject({ dashboardId: 'a', indexInCycle: 0, msUntilNext: 10_000 });
  });

  it('selects within the first slot and reports msUntilNext', () => {
    expect(computeCurrent(slots, 3_000)).toMatchObject({ dashboardId: 'a', msUntilNext: 7_000 });
  });

  it('crosses the boundary into the second slot exactly at its start', () => {
    expect(computeCurrent(slots, 10_000)).toMatchObject({ dashboardId: 'b', indexInCycle: 1, msUntilNext: 15_000 });
  });

  it('selects the second slot mid-way', () => {
    expect(computeCurrent(slots, 20_000)).toMatchObject({ dashboardId: 'b', msUntilNext: 5_000 });
  });

  it('wraps around after a full cycle', () => {
    expect(computeCurrent(slots, 25_000)).toMatchObject({ dashboardId: 'a', indexInCycle: 0 });
    expect(computeCurrent(slots, 28_000)).toMatchObject({ dashboardId: 'a', msUntilNext: 7_000 });
  });

  it('handles negative time defensively', () => {
    expect(computeCurrent(slots, -1_000)).toMatchObject({ dashboardId: 'b' });
  });
});

describe('nextDashboardId', () => {
  it('returns the following slot, wrapping around', () => {
    expect(nextDashboardId(slots, 3_000)).toBe('b');
    expect(nextDashboardId(slots, 20_000)).toBe('a');
  });
  it('returns null for empty rotation', () => {
    expect(nextDashboardId([], 0)).toBeNull();
  });
});

describe('skipWarnings', () => {
  it('warns when a slot is shorter than the poll interval', () => {
    const warnings = skipWarnings(slots, 12_000);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"a"');
  });
  it('is silent when all slots are long enough', () => {
    expect(skipWarnings(slots, 5_000)).toEqual([]);
  });
});
