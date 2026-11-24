import { afterEach, describe, expect, it } from 'vitest';
import { seed, loadSamples } from '../src/db/seed';
import { DEADLINE, DOC, LAWYER, SAMPLES_DIR, setup } from './helpers';

let ctx: ReturnType<typeof setup>;
afterEach(() => ctx?.server.close());

describe('read endpoints', () => {
  it('lists the three lawyers', async () => {
    ctx = setup();
    const res = await ctx.http.get('/api/lawyers');
    expect(res.body.map((l: { id: string }) => l.id).sort()).toEqual(Object.values(LAWYER).sort());
  });

  it('lists every document with its latest review and the supersedes chain', async () => {
    ctx = setup();
    const id = await ctx.startReview(DOC.nda);
    const docs = await ctx.documents();

    expect(docs).toHaveLength(20);
    const byId = new Map(docs.map((d: { id: string }) => [d.id, d]));
    expect(byId.get(DOC.leaseOld)).toMatchObject({ supersedes: null, supersededBy: DOC.leaseNew });
    expect(byId.get(DOC.leaseNew)).toMatchObject({ supersedes: DOC.leaseOld, supersededBy: null });
    expect(byId.get(DOC.nda)).toMatchObject({ latestReview: { id, status: 'in_progress', findingsCount: 0 } });
    expect(byId.get(DOC.msa)).toMatchObject({ latestReview: null });
  });

  it('document detail keeps the previous completed review while a new one runs or after it fails', async () => {
    ctx = setup();
    const first = await ctx.startReview(DOC.nda);
    ctx.reviewer.finding(first, 0);
    ctx.reviewer.complete(first);

    let detail = (await ctx.http.get(`/api/documents/${DOC.nda}`)).body;
    expect(detail.latestReview).toMatchObject({ id: first, status: 'completed' });
    expect(detail.previousCompletedReview).toBeNull();

    const second = await ctx.startReview(DOC.nda, LAWYER.kofi);
    ctx.reviewer.finding(second, 0);
    detail = (await ctx.http.get(`/api/documents/${DOC.nda}`)).body;
    expect(detail.latestReview).toMatchObject({ id: second, status: 'in_progress', findings: [{ position: 0 }] });
    expect(detail.previousCompletedReview).toMatchObject({ id: first, status: 'completed' });

    ctx.reviewer.fail(second);
    detail = (await ctx.http.get(`/api/documents/${DOC.nda}`)).body;
    expect(detail.latestReview).toMatchObject({ id: second, status: 'failed', findings: [{ position: 0 }] });
    expect(detail.previousCompletedReview).toMatchObject({ id: first });
  });

  it('a document reviewed three times (completed, failed, completed) ends with the third as its only result', async () => {
    ctx = setup();
    const listEntry = async () =>
      (await ctx.documents()).find((d: { id: string }) => d.id === DOC.nda);
    const detail = async () => (await ctx.http.get(`/api/documents/${DOC.nda}`)).body;

    const first = await ctx.startReview(DOC.nda);
    ctx.reviewer.finding(first, 0);
    ctx.reviewer.complete(first);

    ctx.time.advanceBy(DEADLINE);
    const second = await ctx.startReview(DOC.nda, LAWYER.kofi);
    ctx.reviewer.finding(second, 0);
    ctx.reviewer.fail(second);

    // After the failed re-review: the attempt failed, but the first review is still the current result.
    expect(await listEntry()).toMatchObject({
      latestReview: { id: second, status: 'failed', failureReason: 'engine_error' },
      lastCompletedReview: { id: first, status: 'completed', findingsCount: 1 },
    });
    expect(await detail()).toMatchObject({ latestReview: { id: second }, previousCompletedReview: { id: first } });

    ctx.time.advanceBy(DEADLINE);
    const third = await ctx.startReview(DOC.nda, LAWYER.priya);
    [0, 1, 2].forEach((position) => ctx.reviewer.finding(third, position));
    ctx.reviewer.complete(third);

    // The third review is the result; neither the failure nor the first review is shown any more.
    expect(await listEntry()).toMatchObject({
      latestReview: { id: third, status: 'completed', findingsCount: 3 },
      lastCompletedReview: { id: third },
    });
    const final = await detail();
    expect(final.latestReview).toMatchObject({ id: third, status: 'completed' });
    expect(final.latestReview.findings).toHaveLength(3);
    expect(final.previousCompletedReview).toBeNull();
    expect(await ctx.plan()).toMatchObject({ used: 2, reserved: 0 }); // the failure cost nothing
  });

  it('keeps null clause and excerpt as null', async () => {
    ctx = setup();
    const id = await ctx.startReview(DOC.nda);
    ctx.reviewer.finding(id, 2);
    expect((await ctx.review(id)).findings[0]).toMatchObject({ clause: null, excerpt: null });
  });

  it('404s on unknown documents and reviews', async () => {
    ctx = setup();
    expect((await ctx.http.get('/api/documents/nope')).status).toBe(404);
    expect((await ctx.http.get('/api/reviews/nope')).status).toBe(404);
    expect((await ctx.requestReview('nope')).body.error.code).toBe('document_not_found');
  });
});

describe('request validation', () => {
  it('a session can only be claimed for a known lawyer', async () => {
    ctx = setup();
    const missing = await ctx.http.post('/api/sessions').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('invalid_request');

    const unknown = await ctx.http.post('/api/sessions').send({ lawyerId: 'someone-else' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('unknown_lawyer');
  });

  it('rejects malformed JSON with a 400', async () => {
    ctx = setup();
    const res = await ctx.http
      .post(`/api/documents/${DOC.nda}/reviews`)
      .set('Content-Type', 'application/json')
      .send('{"requestedBy":');
    expect(res.status).toBe(400);
  });
});

describe('seed', () => {
  it('is idempotent and never touches reviews', async () => {
    ctx = setup();
    const id = await ctx.startReview(DOC.nda);
    seed(ctx.server.db, loadSamples(SAMPLES_DIR));
    const count = (table: string) =>
      (ctx.server.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect([count('lawyers'), count('documents'), count('document_findings')]).toEqual([6, 20, 75]);
    expect(ctx.storedStatus(id)).toBe('in_progress');
  });
});
