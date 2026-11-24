import type { Finding } from '../domain/types';
import type { Cancel, Scheduler } from '../domain/time';
import type { ReviewerListener, ReviewerPort } from './port';

/** Returns a float in [0, 1). Injected so every run is reproducible in tests. */
export type Rng = () => number;

export type Outcome = 'normal' | 'error' | 'slow';

export type PlannedEvent =
  | { atMs: number; kind: 'finding'; position: number }
  | { atMs: number; kind: 'completed' }
  | { atMs: number; kind: 'failed' };

export interface PlannedRun {
  outcome: Outcome;
  /** When the run would complete if nothing went wrong (ms after start). */
  durationMs: number;
  events: PlannedEvent[];
}

/** The fake's timings and chances, from config.json (`fakeReviewer`). */
export interface FakeReviewerSettings {
  /** How long a normal or failing run takes, from start to completion (ms). */
  normalMs: { min: number; max: number };
  /** How long a slow run takes (ms). Longer than the review deadline, so the API times it out. */
  slowMs: { min: number; max: number };
  /** The chance of each outcome, in whole percent. They add up to 100. */
  outcomePercent: { normal: number; error: number; slow: number };
}

const between = (rng: Rng, min: number, max: number) => Math.round(min + rng() * (max - min));

/**
 * One outcome roll per run, so each branch is explicit and no run is ever both slow and failing.
 * With the brief's settings in config.json:
 *   70% normal — findings spread evenly over 5–30s, then completion
 *   20% error  — same pacing, but fails at a random point (possibly before any finding)
 *   10% slow   — findings spread over 60–120s, completion at the end (the API times it out at 60s)
 * Completion is scheduled separately from the findings, so a document with no findings still
 * takes its whole duration instead of completing instantly.
 */
export function planRun(findingsCount: number, rng: Rng, settings: FakeReviewerSettings): PlannedRun {
  const roll = rng();
  const { normal, error } = settings.outcomePercent;
  const outcome: Outcome = roll < normal / 100 ? 'normal' : roll < (normal + error) / 100 ? 'error' : 'slow';
  const range = outcome === 'slow' ? settings.slowMs : settings.normalMs;
  const durationMs = between(rng, range.min, range.max);

  const findings: PlannedEvent[] = Array.from({ length: findingsCount }, (_, position) => ({
    atMs: Math.round((durationMs * (position + 1)) / (findingsCount + 1)),
    kind: 'finding',
    position,
  }));

  if (outcome === 'error') {
    const failAtMs = Math.floor(rng() * durationMs);
    return {
      outcome,
      durationMs,
      events: [...findings.filter((e) => e.atMs < failAtMs), { atMs: failAtMs, kind: 'failed' }],
    };
  }
  return { outcome, durationMs, events: [...findings, { atMs: durationMs, kind: 'completed' }] };
}

/**
 * In-process fake AI. It deliberately does NOT stop at the review deadline: the API must not trust
 * the reviewer, so slow runs keep emitting late events that the domain layer has to discard.
 */
export function createFakeReviewer(
  listener: ReviewerListener,
  deps: { rng: Rng; scheduler: Scheduler; settings: FakeReviewerSettings },
): ReviewerPort {
  const pending = new Map<string, Cancel[]>();

  return {
    start(reviewId, { script }) {
      const run = planRun(script.length, deps.rng, deps.settings);
      const cancels = run.events.map((event) =>
        deps.scheduler.schedule(() => {
          if (event.kind === 'finding') {
            listener.onFinding(reviewId, event.position, script[event.position] as Finding);
            return;
          }
          pending.delete(reviewId);
          if (event.kind === 'completed') listener.onCompleted(reviewId);
          else listener.onFailed(reviewId, 'The AI engine returned an error');
        }, event.atMs),
      );
      pending.set(reviewId, cancels);
    },
    stop() {
      for (const cancels of pending.values()) cancels.forEach((cancel) => cancel());
      pending.clear();
    },
  };
}
