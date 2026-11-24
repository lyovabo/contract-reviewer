/**
 * Runs in a worker thread: one API instance with its OWN SQLite connection to a shared file,
 * making one start-review call when told to. Optionally pauses INSIDE its admission transaction
 * (in `newId`, which runs between the quota check and the insert) until the parent releases it.
 */
import { randomUUID } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { createServer } from '../../src/bootstrap';
import { SAMPLES_DIR, TEST_CONFIG, manualReviewer, noTimers } from '../helpers';

const { dbPath, nowMs, documentId, requestedBy, flags, pauseInsideTransaction } = workerData as {
  dbPath: string;
  nowMs: number;
  documentId: string;
  requestedBy: string;
  flags: SharedArrayBuffer;
  pauseInsideTransaction: boolean;
};
const signals = new Int32Array(flags); // [0] = paused inside the transaction, [1] = may continue
const port = parentPort!;

const server = createServer({
  dbPath,
  samplesDir: SAMPLES_DIR,
  config: TEST_CONFIG,
  clock: { now: () => nowMs },
  scheduler: noTimers,
  reviewerFactory: manualReviewer().factory,
  newId: () => {
    if (pauseInsideTransaction) {
      Atomics.store(signals, 0, 1);
      Atomics.wait(signals, 1, 0, 10_000);
    }
    return randomUUID();
  },
});

port.postMessage({ type: 'ready' });
port.once('message', () => {
  port.postMessage({ type: 'started' });
  try {
    const result = server.service.requestReview(documentId, requestedBy);
    port.postMessage({ type: 'result', result: result.ok ? { ok: true } : { ok: false, error: result.error } });
  } catch (err) {
    port.postMessage({ type: 'result', result: { ok: false, error: 'exception', message: String(err) } });
  } finally {
    server.close();
  }
});
