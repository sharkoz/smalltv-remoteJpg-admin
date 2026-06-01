/**
 * Injectable clock. Production uses the system clock; tests inject a fake one
 * so rotation and cache-expiry logic are deterministic without real sleeps.
 */
export interface Clock {
  now(): Date;
  /** Epoch milliseconds — convenience for arithmetic. */
  nowMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};

/** A controllable clock for tests. Starts at `startMs` and only moves when advanced. */
export class FakeClock implements Clock {
  private current: number;

  constructor(startMs = 0) {
    this.current = startMs;
  }

  now(): Date {
    return new Date(this.current);
  }

  nowMs(): number {
    return this.current;
  }

  /** Move the clock forward by `ms` milliseconds. */
  advance(ms: number): void {
    this.current += ms;
  }

  /** Jump to an absolute epoch-ms value. */
  set(ms: number): void {
    this.current = ms;
  }
}
