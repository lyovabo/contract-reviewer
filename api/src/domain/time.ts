/** Injected everywhere a decision depends on "now", so tests drive the same code paths as production. */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

export type Cancel = () => void;

/** Injected timer source (deadline timers and the fake reviewer's schedule). */
export interface Scheduler {
  schedule(fn: () => void, delayMs: number): Cancel;
}

export const systemClock: Clock = { now: () => Date.now() };

export const systemScheduler: Scheduler = {
  schedule(fn, delayMs) {
    const handle = setTimeout(fn, delayMs);
    return () => clearTimeout(handle);
  },
};

export const toIso = (ms: number): string => new Date(ms).toISOString();
