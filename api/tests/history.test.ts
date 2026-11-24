import { afterEach, describe, expect, it } from 'vitest';
import { compareWithPrevious } from '../src/domain/review-history';
import type { ReviewView } from '../src/domain/types';
import { DEADLINE, DOC, LAWYER, T0, setup } from './helpers';

// A document's review history: every review, newest first, each completed one compared with the
// previous completed one. The NDA's script has 3 findings; the manual reviewer sends any of them.

let ctx: ReturnType<typeof setup>;
afterEach(() => ctx?.server.close());

const history = async (documentId: string) => ctx.http.get(`/api/documents/${documentId}/reviews`);
const titles = (findings: { title: string }[]) => findings.map((f) => f.title);

describe('GET /api/documents/:id/reviews', () => {
  it('404s on an unknown document, and lists nothing for one never reviewed', async () => {
    ctx = setup();
    expect((await history('no-such-document')).status).toBe(404);
    expect((await history('no-such-document')).body.error.code).toBe('document_not_found');
    expect((await history(DOC.consulting)).body).toEqual([]);
  });

  it('lists every review newest first, and compares each completed one with the previous completed one', async () => {
    ctx = setup();

    // First: completed with findings 0 and 1.
    const first = await ctx.startReview(DOC.nda);
    ctx.reviewer.finding(first, 0);
    ctx.reviewer.finding(first, 1);
    ctx.reviewer.complete(first);
    // Then: failed after finding 2. Incomplete, so it is neither compared nor compared with.
    ctx.time.advanceBy(1_000);
    const failed = await ctx.startReview(DOC.nda, LAWYER.kofi);
    ctx.reviewer.finding(failed, 2);
    ctx.reviewer.fail(failed);
    // Then: completed with findings 1 and 2.
    ctx.time.advanceBy(1_000);
    const second = await ctx.startReview(DOC.nda, LAWYER.priya);
    ctx.reviewer.finding(second, 1);
    ctx.reviewer.finding(second, 2);
    ctx.reviewer.complete(second);
    // And one still running.
    ctx.time.advanceBy(1_000);
    const running = await ctx.startReview(DOC.nda);
    ctx.reviewer.finding(running, 0);

    const res = await history(DOC.nda);
    expect(res.status).toBe(200);
    const [r4, r3, r2, r1] = res.body;
    expect(res.body.map((r: { id: string }) => r.id)).toEqual([running, second, failed, first]);
    expect(res.body.map((r: { status: string }) => r.status)).toEqual(['in_progress', 'completed', 'failed', 'completed']);
    expect(r3).toMatchObject({ requestedBy: LAWYER.priya, reviewer: 'fake' });

    const [f0, f1, f2] = ctx.reviewer.started[0]!.script;
    // The second completed review, against the first (the failed one in between is skipped).
    expect(r3.comparedWith).toEqual({ id: first, requestedAt: r1.requestedAt });
    expect(r3.findings.map((f: { title: string; change: string }) => [f.title, f.change])).toEqual([
      [f1!.title, 'unchanged'],
      [f2!.title, 'new'],
    ]);
    expect(titles(r3.noLongerFlagged)).toEqual([f0!.title]);

    // Not compared: the first completed review, the failed one and the running one.
    for (const entry of [r4, r2, r1]) {
      expect(entry.comparedWith).toBeNull();
      expect(entry.noLongerFlagged).toEqual([]);
      expect(entry.findings.every((f: { change: unknown }) => f.change === null)).toBe(true);
    }
    expect(r2).toMatchObject({ failureReason: 'engine_error', findings: [{ title: f2!.title }] });
  });

  it('shows a review past its deadline as timed out, even before the timeout is stored', async () => {
    ctx = setup({ deadlineTimers: false });
    const id = await ctx.startReview(DOC.nda);
    ctx.time.setNow(T0 + DEADLINE);
    expect((await history(DOC.nda)).body).toMatchObject([{ id, status: 'failed', failureReason: 'timeout' }]);
  });
});

describe('comparing a review with the previous one', () => {
  const finding = (clause: string | null, title: string, excerpt: string | null) => ({
    clause,
    title,
    severity: 'high' as const,
    excerpt,
    explanation: 'Why it matters.',
    position: 0,
    receivedAt: '2026-11-12T09:00:05.000Z',
  });
  const review = (id: string, status: ReviewView['status'], findings: ReviewView['findings']): ReviewView => ({
    id,
    documentId: 'doc',
    requestedBy: 'elena',
    requestedAt: `2026-11-12T09:0${id}:00.000Z`,
    deadlineAt: `2026-11-12T09:0${id}:59.000Z`,
    status,
    finishedAt: null,
    failureReason: status === 'failed' ? 'engine_error' : null,
    reviewer: 'claude',
    findings,
  });

  it('matches the same clause and quote despite quote style, spacing and case; the title may differ', () => {
    const before = review('1', 'completed', [finding('8.1', 'Liability capped low', 'The Supplier’s  liability\nshall not exceed')]);
    const after = review('2', 'completed', [finding('8.1', 'Cap on liability is too low', "the supplier's liability shall not exceed")]);
    const [compared] = compareWithPrevious([after, before]);
    expect(compared!.findings[0]!.change).toBe('unchanged');
    expect(compared!.noLongerFlagged).toEqual([]);
  });

  it('a different clause, or a different quote, is a different issue; without a quote the title decides', () => {
    const before = review('1', 'completed', [
      finding('8.1', 'Cap', 'The cap is one month.'),
      finding(null, 'No governing law', null),
    ]);
    const after = review('2', 'completed', [
      finding('8.2', 'Cap', 'The cap is one month.'),
      finding(null, 'Governing law missing', null),
    ]);
    const [compared] = compareWithPrevious([after, before]);
    expect(compared!.findings.map((f) => f.change)).toEqual(['new', 'new']);
    expect(compared!.noLongerFlagged).toHaveLength(2);
  });

  it('a completed review with no earlier completed review is not compared, even after failed ones', () => {
    const entries = compareWithPrevious([
      review('3', 'completed', [finding('1', 'A', null)]),
      review('2', 'failed', [finding('2', 'B', null)]),
    ]);
    expect(entries.map((e) => e.comparedWith)).toEqual([null, null]);
  });
});
