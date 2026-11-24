import { afterEach, describe, expect, it } from 'vitest';
import { utcMonthWindow } from '../src/domain/quota';
import { ALL_DOCS, DEADLINE, DOC, LIMIT, WORKSPACE, docsFor, setup } from './helpers';

let ctx: ReturnType<typeof setup>;
afterEach(() => ctx?.server.close());

describe(`monthly quota: ${LIMIT} reviews per UTC calendar month, failures never count`, () => {
  it('reserves a credit at request, spends it on completion', async () => {
    ctx = setup();
    expect(await ctx.plan()).toMatchObject({ limit: LIMIT, used: 0, reserved: 0, available: LIMIT });

    const id = await ctx.startReview(DOC.nda);
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 1, available: LIMIT - 1 });

    ctx.time.advanceBy(10_000);
    ctx.reviewer.complete(id);
    expect(await ctx.plan()).toMatchObject({ used: 1, reserved: 0, available: LIMIT - 1 });
  });

  it('releases the credit when a review fails, whatever the cause', async () => {
    ctx = setup();
    const engineError = await ctx.startReview(ALL_DOCS[0]!);
    const timedOut = await ctx.startReview(ALL_DOCS[1]!);
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 2, available: LIMIT - 2 });

    ctx.reviewer.fail(engineError);
    ctx.time.advanceBy(DEADLINE); // the second review never answers
    expect(ctx.storedStatus(timedOut)).toBe('failed');
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 0, available: LIMIT });
  });

  it(`${LIMIT - 1} completed + 1 running refuses with slots_reserved, never plan_exhausted`, async () => {
    ctx = setup();
    await ctx.completeReviews(docsFor(LIMIT - 1));
    const running = await ctx.startReview(ALL_DOCS[9]!);

    const res = await ctx.requestReview(ALL_DOCS[10]!);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'slots_reserved',
      plan: { used: LIMIT - 1, reserved: 1, available: 0 },
    });

    // The held credit comes back as soon as the running review fails.
    ctx.reviewer.fail(running);
    expect((await ctx.requestReview(ALL_DOCS[10]!)).status).toBe(201);
  });

  it(`${LIMIT} completed refuses with plan_exhausted and the reset date; one more completion is impossible`, async () => {
    ctx = setup();
    await ctx.completeReviews(docsFor(LIMIT));
    expect(await ctx.plan()).toMatchObject({ used: LIMIT, reserved: 0, available: 0 });

    const res = await ctx.requestReview(ALL_DOCS[10]!);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'plan_exhausted',
      resetsAt: '2026-12-01T00:00:00.000Z',
    });
    expect(ctx.reviewer.started).toHaveLength(LIMIT); // the refused request never reached the reviewer
  });

  it('a new calendar month (UTC) starts with a fresh plan', async () => {
    // Late enough in November for the whole plan to be used before midnight (one review a second).
    ctx = setup({ startMs: Date.UTC(2026, 11, 1) - (LIMIT + 60) * 1_000 });
    await ctx.completeReviews(docsFor(LIMIT));
    expect((await ctx.requestReview(ALL_DOCS[10]!)).body.error.code).toBe('plan_exhausted');

    ctx.time.setNow(Date.UTC(2026, 11, 1, 0, 0, 0));
    expect(await ctx.plan()).toMatchObject({ month: '2026-12', used: 0, available: LIMIT });
    expect((await ctx.requestReview(ALL_DOCS[10]!)).status).toBe(201);
  });

  it('charges the month the review was requested in (requested 30 Nov, completed 1 Dec)', async () => {
    const requestedAt = Date.UTC(2026, 10, 30, 23, 59, 50);
    ctx = setup({ startMs: requestedAt });
    const id = await ctx.startReview(DOC.nda);

    ctx.time.setNow(Date.UTC(2026, 11, 1, 0, 0, 5)); // 15s later, in December
    ctx.reviewer.complete(id);
    expect(ctx.storedStatus(id)).toBe('completed');

    expect(await ctx.plan()).toMatchObject({ month: '2026-12', used: 0, reserved: 0, available: LIMIT });
    expect(ctx.server.repo.usage(WORKSPACE, utcMonthWindow(requestedAt), ctx.time.now())).toEqual({ used: 1, reserved: 0 });
  });

  it('a November review still running in December holds a November credit, not a December one, and still blocks its document', async () => {
    const requestedAt = Date.UTC(2026, 10, 30, 23, 59, 52);
    ctx = setup({ startMs: requestedAt });
    await ctx.startReview(DOC.nda);

    ctx.time.setNow(Date.UTC(2026, 11, 1, 0, 0, 5));
    expect(await ctx.plan()).toMatchObject({ month: '2026-12', used: 0, reserved: 0, available: LIMIT });
    expect(ctx.server.repo.usage(WORKSPACE, utcMonthWindow(requestedAt), ctx.time.now())).toEqual({ used: 0, reserved: 1 });
    expect((await ctx.requestReview(DOC.nda)).body.error.code).toBe('review_in_progress');
  });
});
