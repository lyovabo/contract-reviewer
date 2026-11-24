import { afterEach, describe, expect, it } from 'vitest';
import { ALL_DOCS, DEADLINE, DOC, LAWYER, LIMIT, T0, docsFor, setup } from './helpers';

let ctx: ReturnType<typeof setup>;
afterEach(() => ctx?.server.close());

describe('concurrent requests', () => {
  it('two documents competing for the last credit: exactly one is admitted, the other gets slots_reserved', async () => {
    ctx = setup();
    await ctx.completeReviews(docsFor(LIMIT - 1));
    expect(await ctx.plan()).toMatchObject({ used: LIMIT - 1, reserved: 0, available: 1 });

    const [a, b] = await Promise.all([
      ctx.requestReview(ALL_DOCS[9]!, LAWYER.elena),
      ctx.requestReview(ALL_DOCS[10]!, LAWYER.priya),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const refused = a.status === 409 ? a : b;
    expect(refused.body.error.code).toBe('slots_reserved');
    expect(await ctx.plan()).toMatchObject({ used: LIMIT - 1, reserved: 1, available: 0 });
    expect(ctx.reviewer.started).toHaveLength(LIMIT);
  });

  it('two lawyers requesting the same document: one 201, one 409 carrying the active review id', async () => {
    ctx = setup();
    const [a, b] = await Promise.all([
      ctx.requestReview(DOC.nda, LAWYER.elena),
      ctx.requestReview(DOC.nda, LAWYER.kofi),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const [created, conflict] = a.status === 201 ? [a, b] : [b, a];
    expect(conflict.body.error).toMatchObject({ code: 'review_in_progress', reviewId: created.body.id });
    expect(await ctx.plan()).toMatchObject({ reserved: 1 });

    // Other documents are unaffected.
    expect((await ctx.requestReview(DOC.msa, LAWYER.kofi)).status).toBe(201);
  });

  it('the partial unique index rejects a second in-progress review even if the check is bypassed', async () => {
    ctx = setup();
    await ctx.startReview(DOC.nda);
    expect(() =>
      ctx.server.repo.insertReview({
        id: 'rogue',
        documentId: DOC.nda,
        requestedBy: LAWYER.elena,
        requestedAtMs: T0,
        deadlineAtMs: T0 + DEADLINE,
        reviewer: 'fake',
      }),
    ).toThrow(/UNIQUE constraint failed/);
  });
});
