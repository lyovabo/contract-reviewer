import { afterEach, describe, expect, it } from 'vitest';
import { planRun } from '../src/reviewer/fake-reviewer';
import { DEADLINE, DOC, LIMIT, T0, TEST_CONFIG, scriptedRng, setup } from './helpers';

// Everything below follows the fake's settings in api/config.json.
const SETTINGS = TEST_CONFIG.fakeReviewer;
const { normalMs: NORMAL, slowMs: SLOW } = SETTINGS;
const { normal, error, slow } = SETTINGS.outcomePercent;

/** First rolls that land in each outcome's band (normal below normal%, then error, then slow). */
const NORMAL_ROLL = 0;
const ERROR_ROLL = normal / 100;
const SLOW_ROLL = (normal + error) / 100;

/** The duration a second roll of `r` picks from a range, as planRun does. */
const duration = (r: number, range: { min: number; max: number }) => Math.round(range.min + r * (range.max - range.min));
/** When the k-th of the NDA's 3 findings arrives in a run of `d` ms: spread evenly, as planRun does. */
const findingAt = (d: number, k: number) => Math.round((d * k) / 4);
/** How many of the NDA's 3 findings arrive before `ms`. */
const findingsBefore = (d: number, ms: number) => [1, 2, 3].filter((k) => findingAt(d, k) < ms).length;

let ctx: ReturnType<typeof setup>;
afterEach(() => ctx?.server.close());

/** Small seeded PRNG (mulberry32) for the distribution check. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fake reviewer schedule (pure)', () => {
  it(`rolls one outcome per run: ~${normal}% normal, ~${error}% error, ~${slow}% slow`, () => {
    const rng = seeded(42);
    const counts = { normal: 0, error: 0, slow: 0 };
    for (let i = 0; i < 10_000; i++) counts[planRun(3, rng, SETTINGS).outcome]++;
    expect(counts.normal / 10_000).toBeCloseTo(normal / 100, 1);
    expect(counts.error / 10_000).toBeCloseTo(error / 100, 1);
    expect(counts.slow / 10_000).toBeCloseTo(slow / 100, 1);
  });

  it(`normal and error runs last ${NORMAL.min / 1000}–${NORMAL.max / 1000}s, slow runs ${SLOW.min / 1000}–${SLOW.max / 1000}s`, () => {
    expect(planRun(3, scriptedRng(NORMAL_ROLL, 0), SETTINGS).durationMs).toBe(NORMAL.min);
    expect(planRun(3, scriptedRng(NORMAL_ROLL, 1), SETTINGS).durationMs).toBe(NORMAL.max);
    expect(planRun(3, scriptedRng(SLOW_ROLL, 0), SETTINGS).durationMs).toBe(SLOW.min);
    expect(planRun(3, scriptedRng(SLOW_ROLL, 1), SETTINGS).durationMs).toBe(SLOW.max);
  });

  it(`splits the outcomes exactly at ${normal}% and ${normal + error}%`, () => {
    expect(planRun(3, scriptedRng(ERROR_ROLL - 0.0001, 0), SETTINGS).outcome).toBe('normal');
    expect(planRun(3, scriptedRng(ERROR_ROLL, 0), SETTINGS).outcome).toBe('error');
    expect(planRun(3, scriptedRng(SLOW_ROLL - 0.0001, 0), SETTINGS).outcome).toBe('error');
    expect(planRun(3, scriptedRng(SLOW_ROLL, 0), SETTINGS).outcome).toBe('slow');
  });

  it('an error can strike before any finding', () => {
    expect(planRun(3, scriptedRng(ERROR_ROLL, 0.2, 0), SETTINGS).events).toEqual([{ atMs: 0, kind: 'failed' }]);
  });

  it('takes its timings and chances from the settings', () => {
    const settings = {
      normalMs: { min: 1_000, max: 2_000 },
      slowMs: { min: 9_000, max: 9_000 },
      outcomePercent: { normal: 0, error: 50, slow: 50 },
    };
    expect(planRun(3, scriptedRng(0.0, 1), settings)).toMatchObject({ outcome: 'error', durationMs: 2_000 });
    expect(planRun(3, scriptedRng(0.49, 0), settings)).toMatchObject({ outcome: 'error', durationMs: 1_000 });
    expect(planRun(3, scriptedRng(0.5, 0), settings)).toMatchObject({ outcome: 'slow', durationMs: 9_000 });
  });
});

describe('fake reviewer end to end (scripted RNG, virtual time)', () => {
  it('streams findings one at a time through GET /api/reviews/:id, then completes', async () => {
    // A normal run of d ms: the NDA's findings at d/4, d/2 and 3d/4, then completion at d.
    ctx = setup({ useFakeReviewer: true, rng: scriptedRng(NORMAL_ROLL, 0.2) });
    const d = duration(0.2, NORMAL);
    const id = await ctx.startReview(DOC.nda);

    const seen: [number, string, number][] = [];
    for (const t of [findingAt(d, 1) - 1, findingAt(d, 1), findingAt(d, 2), findingAt(d, 3), d - 1, d]) {
      ctx.time.advanceTo(T0 + t);
      const review = await ctx.review(id);
      seen.push([t, review.status, review.findings.length]);
    }
    expect(seen).toEqual([
      [findingAt(d, 1) - 1, 'in_progress', 0],
      [findingAt(d, 1), 'in_progress', 1],
      [findingAt(d, 2), 'in_progress', 2],
      [findingAt(d, 3), 'in_progress', 3],
      [d - 1, 'in_progress', 3],
      [d, 'completed', 3],
    ]);
    expect(await ctx.plan()).toMatchObject({ used: 1, reserved: 0 });
  });

  it('keeps every one of the 20 MSA findings in order', async () => {
    ctx = setup({ useFakeReviewer: true, rng: scriptedRng(NORMAL_ROLL, 1) });
    const id = await ctx.startReview(DOC.msa);
    ctx.time.advanceBy(NORMAL.max);
    const review = await ctx.review(id);
    expect(review.status).toBe('completed');
    expect(review.findings.map((f: { position: number }) => f.position)).toEqual([...Array(20).keys()]);
  });

  it('an error run keeps the findings returned before the error', async () => {
    // An error run of d ms that fails at 60% of it: the findings at d/4 and d/2 come first.
    ctx = setup({ useFakeReviewer: true, rng: scriptedRng(ERROR_ROLL, 0.2, 0.6) });
    const d = duration(0.2, NORMAL);
    const id = await ctx.startReview(DOC.nda);
    ctx.time.advanceBy(DEADLINE);
    const review = await ctx.review(id);
    expect(review).toMatchObject({ status: 'failed', failureReason: 'engine_error' });
    expect(review.findings).toHaveLength(findingsBefore(d, Math.floor(0.6 * d)));
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 0 });
  });

  it('a slow run always times out: findings after the deadline and the late completion are discarded', async () => {
    // A slow run of d ms, longer than the deadline: only the findings before the deadline count.
    ctx = setup({ useFakeReviewer: true, rng: scriptedRng(SLOW_ROLL, 0.5) });
    const d = duration(0.5, SLOW);
    const id = await ctx.startReview(DOC.nda);

    ctx.time.advanceTo(T0 + SLOW.max);
    const review = await ctx.review(id);
    expect(review).toMatchObject({ status: 'failed', failureReason: 'timeout' });
    expect(review.findings).toHaveLength(findingsBefore(d, DEADLINE));
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 0, available: LIMIT });
  });

  it(`a slow run at its minimum duration (${SLOW.min / 1000}s) still times out: its completion is too late`, async () => {
    // The zero-findings document, so completion is the only event. With slowMs.min equal to the
    // deadline (the brief's 60 s), the completion lands exactly on the deadline tick, and loses.
    ctx = setup({ useFakeReviewer: true, rng: scriptedRng(SLOW_ROLL, 0) });
    const id = await ctx.startReview(DOC.consulting);

    ctx.time.advanceTo(T0 + SLOW.min);
    expect(ctx.server.repo.getReview(id)).toMatchObject({ status: 'failed', failure_reason: 'timeout' });
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 0, available: LIMIT });
  });

  it('a document with no findings still takes its whole duration, then completes with none', async () => {
    ctx = setup({ useFakeReviewer: true, rng: scriptedRng(NORMAL_ROLL, 0.2) });
    const d = duration(0.2, NORMAL);
    const id = await ctx.startReview(DOC.consulting);
    ctx.time.advanceTo(T0 + d - 1);
    expect(await ctx.review(id)).toMatchObject({ status: 'in_progress' });
    ctx.time.advanceTo(T0 + d);
    expect(await ctx.review(id)).toMatchObject({ status: 'completed', findings: [] });
  });
});
