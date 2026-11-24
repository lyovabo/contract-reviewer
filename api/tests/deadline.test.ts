import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_DOCS, DEADLINE, DOC, LAWYER, LIMIT, T0, docsFor, manualReviewer, ms, setup } from './helpers';

let ctx: ReturnType<typeof setup>;
afterEach(() => {
  vi.restoreAllMocks();
  ctx?.server.close();
});

/**
 * The deadline rule (reviewDeadlineMs in api/config.json) runs on the injected clock that is bound into the SQL guards. `time.setNow` moves
 * that clock without firing timers, so these tests hit the guard itself, not the timeout timer.
 */
describe(`the ${DEADLINE / 1000}-second deadline`, () => {
  it(`a completion at ${ms(DEADLINE - 1)} ms completes the review and spends a credit`, async () => {
    ctx = setup();
    const id = await ctx.startReview(DOC.nda);

    ctx.time.setNow(T0 + DEADLINE - 1);
    ctx.reviewer.complete(id);

    expect(ctx.storedStatus(id)).toBe('completed');
    expect(await ctx.plan()).toMatchObject({ used: 1, reserved: 0 });
    ctx.time.advanceBy(10_000); // the timeout timer was cancelled and cannot undo it
    expect(await ctx.review(id)).toMatchObject({ status: 'completed', failureReason: null });
  });

  it(`a completion at exactly ${ms(DEADLINE)} ms is rejected before any timeout callback runs`, async () => {
    ctx = setup();
    const id = await ctx.startReview(DOC.nda);

    ctx.time.setNow(T0 + DEADLINE);
    expect(ctx.time.pendingTimers()).toBe(1); // the deadline timer has NOT run
    ctx.reviewer.complete(id);

    expect(await ctx.review(id)).toMatchObject({
      status: 'failed',
      failureReason: 'timeout',
      finishedAt: new Date(T0 + DEADLINE).toISOString(),
    });
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 0, available: LIMIT });

    ctx.time.advanceBy(1); // the timer now fires: still exactly one terminal state
    expect(await ctx.review(id)).toMatchObject({ status: 'failed', failureReason: 'timeout' });
  });

  it(`a finding at ${ms(DEADLINE - 1)} ms is kept; findings from ${ms(DEADLINE)} ms on are discarded`, async () => {
    ctx = setup();
    const id = await ctx.startReview(DOC.nda);

    ctx.time.setNow(T0 + DEADLINE - 1);
    ctx.reviewer.finding(id, 0);
    ctx.time.setNow(T0 + DEADLINE);
    ctx.reviewer.finding(id, 1);
    ctx.time.setNow(T0 + DEADLINE + 35_000);
    ctx.reviewer.finding(id, 2);
    ctx.reviewer.complete(id);

    const review = await ctx.review(id);
    expect(review.status).toBe('failed');
    expect(review.findings.map((f: { position: number }) => f.position)).toEqual([0]);
    expect(await ctx.plan()).toMatchObject({ used: 0 });
  });

  it('the timeout timer persists the failure at exactly the deadline for a silent reviewer, freeing the credit', async () => {
    ctx = setup();
    const id = await ctx.startReview(DOC.nda);

    ctx.time.advanceTo(T0 + DEADLINE - 1);
    expect(ctx.storedStatus(id)).toBe('in_progress');
    ctx.time.advanceTo(T0 + DEADLINE);
    expect(ctx.server.repo.getReview(id)).toMatchObject({
      status: 'failed',
      failure_reason: 'timeout',
      finished_at_ms: T0 + DEADLINE,
    });
    expect(await ctx.plan()).toMatchObject({ reserved: 0, available: LIMIT });
  });

  it('reads report an overdue review as failed even if no timer ever persisted it', async () => {
    ctx = setup({ deadlineTimers: false });
    const id = await ctx.startReview(DOC.nda);

    ctx.time.setNow(T0 + DEADLINE);
    expect(ctx.storedStatus(id)).toBe('in_progress'); // nothing has written the timeout yet
    expect(await ctx.review(id)).toMatchObject({ status: 'failed', failureReason: 'timeout' });
    expect(await ctx.plan()).toMatchObject({ reserved: 0, available: LIMIT });
    const doc = (await ctx.http.get(`/api/documents/${DOC.nda}`)).body;
    expect(doc.latestReview).toMatchObject({ status: 'failed', failureReason: 'timeout' });
    const list = await ctx.documents();
    expect(list.find((d: { id: string }) => d.id === DOC.nda).latestReview).toMatchObject({
      status: 'failed',
      failureReason: 'timeout',
    });
  });

  it(`an engine failure reported at exactly ${ms(DEADLINE)} ms is recorded as a timeout`, async () => {
    ctx = setup({ deadlineTimers: false });
    const id = await ctx.startReview(DOC.nda);
    ctx.time.setNow(T0 + DEADLINE);
    ctx.reviewer.fail(id);
    expect(ctx.server.repo.getReview(id)).toMatchObject({ status: 'failed', failure_reason: 'timeout' });
  });

  it('an overdue review whose timer never fired does not hold the last credit against another document', async () => {
    ctx = setup({ deadlineTimers: false });
    await ctx.completeReviews(docsFor(LIMIT - 1));
    const overdue = await ctx.startReview(ALL_DOCS[9]!);
    const startedAt = ctx.time.now();

    ctx.time.setNow(startedAt + DEADLINE + 1_000);
    expect(ctx.storedStatus(overdue)).toBe('in_progress');
    expect((await ctx.requestReview(ALL_DOCS[10]!)).status).toBe(201);
    expect(ctx.storedStatus(overdue)).toBe('failed');
  });

  it('the last credit is freed at exactly the deadline: refused slots_reserved one millisecond earlier, admitted on the tick', async () => {
    ctx = setup({ deadlineTimers: false });
    await ctx.completeReviews(docsFor(LIMIT - 1));
    const overdue = await ctx.startReview(ALL_DOCS[9]!);
    const startedAt = ctx.time.now();

    ctx.time.setNow(startedAt + DEADLINE - 1);
    expect((await ctx.requestReview(ALL_DOCS[10]!)).body.error.code).toBe('slots_reserved');
    expect(ctx.storedStatus(overdue)).toBe('in_progress');

    ctx.time.setNow(startedAt + DEADLINE);
    expect((await ctx.requestReview(ALL_DOCS[10]!)).status).toBe(201);
    expect(ctx.storedStatus(overdue)).toBe('failed');
  });

  it('a timer that fires early re-arms instead of leaving the review running past its deadline', async () => {
    let first = true; // the first timer fires 1 ms early, as a real timer can against the wall clock
    ctx = setup({
      scheduler: (time) => ({
        schedule(fn, delayMs) {
          const delay = first ? delayMs - 1 : delayMs;
          first = false;
          return time.schedule(fn, delay);
        },
      }),
    });
    const id = await ctx.startReview(DOC.nda);

    ctx.time.advanceTo(T0 + DEADLINE - 1);
    expect(ctx.storedStatus(id)).toBe('in_progress');
    expect(ctx.time.pendingTimers()).toBe(1); // re-armed for the remaining millisecond
    ctx.time.advanceTo(T0 + DEADLINE);
    expect(ctx.server.repo.getReview(id)).toMatchObject({ status: 'failed', failure_reason: 'timeout' });
  });

  it('the unique-index backstop answers 409 review_in_progress if the in-transaction check ever misses', async () => {
    ctx = setup();
    const active = await ctx.startReview(DOC.nda);
    vi.spyOn(ctx.server.repo, 'findActiveReview').mockReturnValueOnce(undefined); // simulate a regressed check

    const res = await ctx.requestReview(DOC.nda, LAWYER.kofi);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'review_in_progress', reviewId: active });
    expect(await ctx.plan()).toMatchObject({ reserved: 1 });
  });

  it('a retry 1 s after the deadline is admitted even though the timeout timer never fired', async () => {
    ctx = setup({ deadlineTimers: false });
    const first = await ctx.startReview(DOC.nda);

    ctx.time.setNow(T0 + DEADLINE + 1_000);
    const res = await ctx.requestReview(DOC.nda);

    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(first);
    expect(ctx.server.repo.getReview(first)).toMatchObject({ status: 'failed', failure_reason: 'timeout' });
  });

  it(`a retry at exactly t=${ms(DEADLINE)} ms is admitted: the expiry boundary matches the deadline guard`, async () => {
    ctx = setup({ deadlineTimers: false });
    const first = await ctx.startReview(DOC.nda);

    ctx.time.setNow(T0 + DEADLINE);
    const res = await ctx.requestReview(DOC.nda);

    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(first);
    expect(ctx.server.repo.getReview(first)).toMatchObject({ status: 'failed', failure_reason: 'timeout' });
  });

  it("late events from a timed-out review never touch its retry, and never consume the plan", async () => {
    ctx = setup();
    const first = await ctx.startReview(DOC.nda);
    ctx.reviewer.finding(first, 0);
    ctx.time.advanceTo(T0 + DEADLINE + 1_000); // first times out at the deadline
    const retry = await ctx.startReview(DOC.nda);

    // The slow first run finally delivers the rest of its findings and its completion.
    ctx.time.advanceBy(5_000);
    ctx.reviewer.finding(first, 1);
    ctx.reviewer.finding(first, 2);
    ctx.reviewer.complete(first);

    expect(await ctx.review(first)).toMatchObject({ status: 'failed', failureReason: 'timeout' });
    expect((await ctx.review(first)).findings).toHaveLength(1);
    expect(await ctx.review(retry)).toMatchObject({ status: 'in_progress', findings: [] });
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 1 });

    ctx.reviewer.finding(retry, 0);
    ctx.reviewer.complete(retry);
    expect(await ctx.review(retry)).toMatchObject({ status: 'completed' });
    expect((await ctx.review(retry)).findings).toHaveLength(1);
    expect(await ctx.plan()).toMatchObject({ used: 1, reserved: 0 });
  });

  it('a review ends exactly once: a failure after completion is discarded', async () => {
    ctx = setup();
    const id = await ctx.startReview(DOC.nda);
    ctx.time.advanceBy(10_000);
    ctx.reviewer.complete(id);
    ctx.reviewer.fail(id);
    ctx.reviewer.finding(id, 0);
    expect(await ctx.review(id)).toMatchObject({ status: 'completed', findings: [] });
  });
});

describe('review failures', () => {
  it('an engine error keeps the partial findings and releases the credit', async () => {
    ctx = setup();
    const id = await ctx.startReview(DOC.nda);
    ctx.reviewer.finding(id, 0);
    ctx.reviewer.finding(id, 1);
    ctx.reviewer.fail(id);

    const review = await ctx.review(id);
    expect(review).toMatchObject({ status: 'failed', failureReason: 'engine_error' });
    expect(review.findings).toHaveLength(2);
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 0 });
  });

  it('a reviewer that cannot be launched marks that attempt failed and frees the credit', async () => {
    ctx = setup({ reviewer: manualReviewer({ failToLaunch: true }) });
    const res = await ctx.requestReview(DOC.nda);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'failed', failureReason: 'launch_error' });
    expect(await ctx.plan()).toMatchObject({ reserved: 0, available: LIMIT });
    expect((await ctx.requestReview(DOC.nda)).status).toBe(201); // the document is not blocked
  });

  it('a failed review never blocks the next request on the same document', async () => {
    ctx = setup();
    for (const _ of [1, 2, 3]) {
      const id = await ctx.startReview(ALL_DOCS[0]!);
      ctx.reviewer.fail(id);
    }
    expect(await ctx.plan()).toMatchObject({ used: 0, available: LIMIT });
  });
});
