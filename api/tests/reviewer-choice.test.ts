import { afterEach, describe, expect, it } from 'vitest';
import { DEADLINE, DOC, LAWYER, LIMIT, T0, manualReviewer, setup } from './helpers';

// The lawyer chooses the AI for each review in the app: the simulated one (the default) or Claude,
// which the server offers only when it has an Anthropic API key (ANTHROPIC_API_KEY).

let ctx: ReturnType<typeof setup>;
afterEach(() => ctx?.server.close());

describe('choosing the AI for a review', () => {
  it('without an API key, only the simulated AI is offered, and a Claude request is refused at no cost', async () => {
    ctx = setup();
    expect((await ctx.http.get('/api/settings')).body.reviewers).toEqual(['fake']);

    const refused = await ctx.requestReview(DOC.nda, LAWYER.elena, 'claude');
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('reviewer_unavailable');
    expect(await ctx.plan()).toMatchObject({ used: 0, reserved: 0, available: LIMIT });
    expect((await ctx.http.get(`/api/documents/${DOC.nda}`)).body.latestReview).toBeNull();

    const id = await ctx.startReview(DOC.nda); // no choice sent: the simulated AI
    expect(await ctx.review(id)).toMatchObject({ reviewer: 'fake' });
    expect(ctx.reviewer.started.map((s) => s.reviewId)).toEqual([id]);
  });

  it('with an API key, each review runs on the AI its lawyer chose, and both share the plan', async () => {
    const claude = manualReviewer();
    ctx = setup({ claudeReviewerFactory: () => claude.factory });
    expect((await ctx.http.get('/api/settings')).body.reviewers).toEqual(['fake', 'claude']);

    const byClaude = await ctx.startReview(DOC.nda, LAWYER.elena, 'claude');
    const simulated = await ctx.startReview(DOC.msa, LAWYER.elena, 'fake');
    expect(claude.started.map((s) => s.reviewId)).toEqual([byClaude]);
    expect(ctx.reviewer.started.map((s) => s.reviewId)).toEqual([simulated]);
    expect(await ctx.review(byClaude)).toMatchObject({ reviewer: 'claude' });
    expect(await ctx.review(simulated)).toMatchObject({ reviewer: 'fake' });
    expect(await ctx.plan()).toMatchObject({ reserved: 2 });

    claude.complete(byClaude);
    expect(await ctx.plan()).toMatchObject({ used: 1, reserved: 1 });
    const listed = (await ctx.documents()).find((d: { id: string }) => d.id === DOC.nda);
    expect(listed.latestReview).toMatchObject({ status: 'completed', reviewer: 'claude' });
  });

  it("Claude's late events are discarded like any other: a completion at the deadline is a timeout", async () => {
    const claude = manualReviewer();
    ctx = setup({ claudeReviewerFactory: () => claude.factory });
    const id = await ctx.startReview(DOC.nda, LAWYER.elena, 'claude');

    ctx.time.setNow(T0 + DEADLINE);
    claude.complete(id);
    expect(await ctx.review(id)).toMatchObject({ status: 'failed', failureReason: 'timeout', reviewer: 'claude' });
    expect(await ctx.plan()).toMatchObject({ used: 0 });
  });

  it.each([['gpt'], [42], [null]])('refuses an unknown AI (%j) without starting anything', async (reviewer) => {
    ctx = setup();
    const token = (await ctx.http.post('/api/sessions').send({ lawyerId: LAWYER.elena })).body.token;
    const res = await ctx.http
      .post(`/api/documents/${DOC.nda}/reviews`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reviewer });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'invalid_request', message: 'reviewer must be "fake" or "claude"' });
    expect(ctx.reviewer.started).toEqual([]);
  });
});
