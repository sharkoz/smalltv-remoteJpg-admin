/**
 * Pure rotation math. The "current" dashboard for a device is derived purely
 * from wall-clock time and per-slot durations — no mutable cursor — so it
 * survives restarts and is trivially testable with a fake clock.
 */

export interface RotationSlot {
  dashboardId: string;
  displayDurationMs: number;
}

export interface RotationState {
  /** null when the device has no slots. */
  dashboardId: string | null;
  /** Index of the current slot within the cycle, or -1 when empty. */
  indexInCycle: number;
  /** Milliseconds until the rotation advances to the next slot. */
  msUntilNext: number;
}

/** Compute which slot is showing at `nowMs`. */
export function computeCurrent(slots: RotationSlot[], nowMs: number): RotationState {
  if (slots.length === 0) {
    return { dashboardId: null, indexInCycle: -1, msUntilNext: 0 };
  }
  const cycleLength = slots.reduce((sum, s) => sum + s.displayDurationMs, 0);
  // Normalize into [0, cycleLength) even for negative inputs.
  let t = nowMs % cycleLength;
  if (t < 0) t += cycleLength;

  let acc = 0;
  for (let i = 0; i < slots.length; i++) {
    const dur = slots[i]!.displayDurationMs;
    if (t < acc + dur) {
      return {
        dashboardId: slots[i]!.dashboardId,
        indexInCycle: i,
        msUntilNext: acc + dur - t,
      };
    }
    acc += dur;
  }
  // Floating-safety fallback: last slot.
  const last = slots.length - 1;
  return { dashboardId: slots[last]!.dashboardId, indexInCycle: last, msUntilNext: 0 };
}

/** Dashboard shown immediately after the current one (wraps around). */
export function nextDashboardId(slots: RotationSlot[], nowMs: number): string | null {
  if (slots.length === 0) return null;
  const { indexInCycle } = computeCurrent(slots, nowMs);
  const next = (indexInCycle + 1) % slots.length;
  return slots[next]!.dashboardId;
}

/**
 * Slots whose duration is shorter than the device poll interval risk being
 * skipped (the device may never poll while they're showing). Returns a warning
 * per offending slot.
 */
export function skipWarnings(slots: RotationSlot[], pollIntervalMs: number): string[] {
  return slots
    .filter((s) => s.displayDurationMs < pollIntervalMs)
    .map(
      (s) =>
        `Dashboard "${s.dashboardId}" shows for ${s.displayDurationMs}ms but the device polls every ${pollIntervalMs}ms — it may be skipped.`,
    );
}
