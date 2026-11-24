import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/bootstrap';
import { DEADLINE, DOC, LIMIT, SAMPLES_DIR, T0, TEST_CONFIG, manualReviewer, noTimers, setup } from './helpers';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('restart with a file-backed database', () => {
  it('fails what was running (timeout if overdue, interrupted otherwise) and keeps completed reviews', async () => {
    dir = mkdtempSync(join(tmpdir(), 'contract-reviewer-restart-'));
    const dbPath = join(dir, 'contract-reviewer.db');

    // --- first process ---
    const before = setup({ dbPath });
    const completed = await before.startReview(DOC.nda);
    before.reviewer.finding(completed, 0);
    before.reviewer.finding(completed, 1);
    before.reviewer.finding(completed, 2);
    before.time.advanceBy(DEADLINE / 2);
    before.reviewer.complete(completed);

    // Restarted 10 s after one review's deadline, and halfway through the other's.
    const overdueAt = T0 + DEADLINE;
    const restartAt = overdueAt + DEADLINE + 10_000;
    const unexpiredAt = restartAt - DEADLINE / 2;
    before.time.setNow(overdueAt);
    const overdue = await before.startReview(DOC.msa); // its deadline passes before the restart
    before.reviewer.finding(overdue, 0);
    before.time.setNow(unexpiredAt);
    const unexpired = await before.startReview(DOC.leaseNew); // its deadline is after the restart
    expect(await before.plan()).toMatchObject({ used: 1, reserved: 2 });

    // Crash: the process dies, its timers with it. Only the file survives.
    before.server.close();

    // --- second process ---
    const after = setup({ dbPath, startMs: restartAt });
    try {
      expect(after.server.sweep).toEqual({ timedOut: 1, interrupted: 1 });

      expect(after.server.repo.getReview(overdue)).toMatchObject({
        status: 'failed',
        failure_reason: 'timeout',
        finished_at_ms: overdueAt + DEADLINE,
      });
      expect(await after.review(overdue)).toMatchObject({ status: 'failed', findings: [{ position: 0 }] });
      expect(after.server.repo.getReview(unexpired)).toMatchObject({
        status: 'failed',
        failure_reason: 'interrupted',
        finished_at_ms: restartAt,
      });

      const survivor = await after.review(completed);
      expect(survivor).toMatchObject({ status: 'completed', failureReason: null });
      expect(survivor.findings.map((f: { title: string }) => f.title)).toEqual([
        'Protection runs one way only',
        'Residuals clause lets the other side reuse ideas',
        'No duty to return or destroy information',
      ]);

      expect(await after.plan()).toMatchObject({ used: 1, reserved: 0, available: LIMIT - 1 });
      expect((await after.requestReview(DOC.leaseNew)).status).toBe(201); // nothing is stranded
      const lawyers = (await after.http.get('/api/lawyers')).body;
      expect(lawyers).toHaveLength(6); // re-seeding was idempotent
    } finally {
      after.server.close();
    }
  });

  it.each([
    [DEADLINE - 1, 'interrupted'],
    [DEADLINE, 'timeout'],
  ])('a restart %i ms after the request marks the review %s', async (elapsed, reason) => {
    dir = mkdtempSync(join(tmpdir(), 'contract-reviewer-restart-'));
    const dbPath = join(dir, 'contract-reviewer.db');
    const before = setup({ dbPath, deadlineTimers: false });
    const id = await before.startReview(DOC.nda);
    before.server.close();

    const after = createServer({
      dbPath,
      samplesDir: SAMPLES_DIR,
      config: TEST_CONFIG,
      clock: { now: () => T0 + elapsed },
      scheduler: noTimers,
      reviewerFactory: manualReviewer().factory,
    });
    try {
      expect(after.repo.getReview(id)).toMatchObject({ status: 'failed', failure_reason: reason });
    } finally {
      after.close();
    }
  });
});
