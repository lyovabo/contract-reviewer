import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection';
import { ALL_DOCS, LAWYER, LIMIT, TEST_CONFIG, docsFor, setup } from './helpers';

let dir: string | undefined;
const workers: Worker[] = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map((w) => w.terminate()));
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function nextMessage<T = unknown>(worker: Worker, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: { type: string; result?: T }) => {
      if (message.type !== type) return;
      worker.off('message', onMessage);
      resolve(message.result as T);
    };
    worker.on('message', onMessage);
    worker.once('error', reject);
  });
}

async function until(condition: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await sleep(5);
  }
}

/**
 * The single-connection tests serialize requests on one event loop. Here two API instances, each
 * with its own connection to the same file, really overlap: A is paused inside its admission
 * transaction (after the quota check, before the insert) while B makes its own request.
 *
 * What this pins: admission takes the write lock BEFORE it reads the quota. Today two things
 * guarantee that: `.immediate()`, and step 1 (persist timeouts) being a write. Mutation-checked:
 * with a deferred transaction AND step 1 moved away, A's snapshot goes stale and its insert fails
 * with "database is locked", which fails this test. `.immediate()` keeps it safe whatever the
 * statement order.
 */
describe('two connections racing for the last credit', () => {
  it('admits exactly one; the other is refused with slots_reserved (never both, never an error)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'contract-reviewer-race-'));
    const dbPath = join(dir, 'contract-reviewer.db');

    const prep = setup({ dbPath });
    await prep.completeReviews(docsFor(LIMIT - 1));
    const nowMs = prep.time.now() + 1_000;
    prep.server.close();

    const flags = new SharedArrayBuffer(8);
    const signals = new Int32Array(flags);
    const spawn = (documentId: string, requestedBy: string, pauseInsideTransaction: boolean) => {
      const worker = new Worker(new URL('./race/worker.mjs', import.meta.url), {
        workerData: { dbPath, nowMs, documentId, requestedBy, flags, pauseInsideTransaction },
      });
      workers.push(worker);
      return worker;
    };

    const a = spawn(ALL_DOCS[9]!, LAWYER.elena, true);
    const b = spawn(ALL_DOCS[10]!, LAWYER.priya, false);
    await Promise.all([nextMessage(a, 'ready'), nextMessage(b, 'ready')]);

    const resultA = nextMessage(a, 'result');
    a.postMessage('go');
    await until(() => Atomics.load(signals, 0) === 1); // A is inside its transaction, quota already checked

    const resultB = nextMessage(b, 'result');
    const bStarted = nextMessage(b, 'started');
    b.postMessage('go');
    await bStarted;
    await sleep(150); // B is now inside its own start-review call while A still holds its transaction

    Atomics.store(signals, 1, 1);
    Atomics.notify(signals, 1);

    expect(await resultA).toEqual({ ok: true });
    expect(await resultB).toEqual({ ok: false, error: 'slots_reserved' });

    const db = openDatabase(dbPath, TEST_CONFIG.reviewDeadlineMs);
    try {
      const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM reviews GROUP BY status ORDER BY status`).all();
      expect(rows).toEqual([
        { status: 'completed', n: LIMIT - 1 },
        { status: 'in_progress', n: 1 },
      ]);
    } finally {
      db.close();
    }
  }, 20_000);
});
