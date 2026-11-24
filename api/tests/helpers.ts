import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createServer } from '../src/bootstrap';
import { DEFAULT_CONFIG_FILE, loadConfig, type AppConfig } from '../src/config';
import { SAMPLE_WORKSPACE } from '../src/db/seed';
import type { Cancel, Clock, Scheduler } from '../src/domain/time';
import type { Finding, ReviewerKind } from '../src/domain/types';
import type { ReviewerFactory, ReviewerListener } from '../src/reviewer/port';
import type { Rng } from '../src/reviewer/fake-reviewer';

export const SAMPLES_DIR = fileURLToPath(new URL('../../samples', import.meta.url));

/** The single workspace the sample data seeds. */
export const WORKSPACE = SAMPLE_WORKSPACE.id;

/**
 * The settings every test runs with: whatever api/config.json says. Tests take every value of a
 * setting from here (or from the shorthands below), never a number of their own, so editing the
 * file never breaks a test. Tests that need a different value, such as a 20-second deadline, pass
 * it to setup({ config }).
 */
export const TEST_CONFIG: AppConfig = loadConfig(DEFAULT_CONFIG_FILE);

/** A review still running this long after it was requested has failed (ms). */
export const DEADLINE = TEST_CONFIG.reviewDeadlineMs;
/** Reviews a workspace may complete per month. */
export const LIMIT = TEST_CONFIG.monthlyReviewLimit;
/** A session ends this long after its last heartbeat (ms). */
export const SESSION_TTL = TEST_CONFIG.sessionTtlMs;

/** 60000 → "60,000", for test names. */
export const ms = (value: number) => value.toLocaleString('en-US');

/** 12 Nov 2026, 09:00 UTC — mid-month, so tests are not near a rollover unless they want to be. */
export const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);

export const LAWYER = {
  elena: '9827c4e1-cac8-4824-9872-b7c7f48f4e5c', // Partner
  tomas: '2a8b8e3f-d544-4252-9a81-0cefdbb9ff34', // Partner
  priya: '9e13ae7a-33c5-4058-9264-b23203b4c1ff', // Senior associate
  jonas: '3d6b497a-b7a1-4aa4-9c4b-3701b43e095a', // Associate
  amelie: 'b5f1ce9b-6068-46c3-b93e-d4a434c3f62f', // Associate
  kofi: '7659a86f-ed99-45d3-8aa0-6d38a8a8a221', // Trainee lawyer
};

export const DOC = {
  nda: '781cb31d-2941-4006-a12e-1269022a1c7c', // 3 findings
  leaseOld: 'c6e11de5-6cfb-476f-946a-f81abd749cc0',
  leaseNew: '361e1bda-7cf6-430e-85f6-a76dda10f9d9', // supersedes leaseOld, same title
  consulting: '1efd34ae-509d-48f4-9674-9ff59b8d65e1', // 0 findings
  msa: '2a5580ec-4e9d-4682-b521-4c55a7802fb9', // 20 findings, the longest stream
};

/** Every document id, in sample order (20 of them). */
export const ALL_DOCS = [
  DOC.nda,
  DOC.leaseOld,
  DOC.leaseNew,
  'cf1031cd-b9d5-4a2c-b074-be962bd50657',
  '502aedf7-1b9e-4089-a747-091417bca787',
  '8bd79e84-d1bd-442a-b5cb-afdfc2d38be3',
  '48713320-45cf-4fad-920f-f4d27b580979',
  DOC.consulting,
  'e54dcff9-80a3-404f-929e-22815fb37094',
  '2e51e89b-6ee8-428e-96bd-1ef35b1d98df',
  '44b0a58e-2118-48a9-8df8-5d682f1026e1',
  '8086a08c-d5d6-4e5e-88d7-a0f429a119aa',
  DOC.msa,
  '25b142ab-25d4-483b-a0bd-5323b23534dc',
  '1e745cf7-2839-4a37-a548-f8cfd13b4cc7',
  'd3bdb0d5-6656-48ae-9fe4-5f6ca852ebdf',
  '2b3da16d-f739-4a46-abbb-f271967ca4eb',
  '1ad24b81-508a-45b5-917a-2651ea965766',
  '5cabd3e2-e29e-4f2e-ae8b-3164f9c3fcf4',
  'a9c8f732-85b6-4e69-8c77-a6d996d159ca',
];

/**
 * Documents for `n` reviews that run one after another, such as a month's whole plan: the sample
 * documents in turn, again from the first when there are more reviews than documents. A document
 * can be reviewed again once its review has finished.
 */
export const docsFor = (n: number) => Array.from({ length: n }, (_, i) => ALL_DOCS[i % ALL_DOCS.length]!);

/**
 * Deterministic fake time: one clock and one timer queue shared by the deadline timers and the
 * fake reviewer. `setNow` moves the clock WITHOUT running timers — that is how a test delivers an
 * event at t=60,000 ms before the timeout callback has had a chance to run.
 */
export class VirtualTime implements Clock, Scheduler {
  private current: number;
  private seq = 0;
  private timers: { at: number; seq: number; fn: () => void; cancelled: boolean }[] = [];

  constructor(startMs: number) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  schedule(fn: () => void, delayMs: number): Cancel {
    const timer = { at: this.current + Math.max(0, delayMs), seq: this.seq++, fn, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  setNow(ms: number): void {
    this.current = ms;
  }

  /** Runs every timer due up to `target`, in time order, with the clock at each timer's due time. */
  advanceTo(target: number): void {
    for (;;) {
      const due = this.timers
        .filter((t) => !t.cancelled && t.at <= target)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      due.cancelled = true;
      this.current = Math.max(this.current, due.at);
      due.fn();
    }
    this.current = Math.max(this.current, target);
    this.timers = this.timers.filter((t) => !t.cancelled);
  }

  advanceBy(ms: number): void {
    this.advanceTo(this.current + ms);
  }

  pendingTimers(): number {
    return this.timers.filter((t) => !t.cancelled).length;
  }
}

/** Disables timers entirely, e.g. to prove a rule holds even when the timeout timer never fires. */
export const noTimers: Scheduler = { schedule: () => () => {} };

/** A reviewer the test drives by hand: it records starts and lets the test emit any event, any time. */
export function manualReviewer(opts: { failToLaunch?: boolean } = {}) {
  let listener: ReviewerListener | undefined;
  const started: { reviewId: string; script: readonly Finding[] }[] = [];
  const factory: ReviewerFactory = (l) => {
    listener = l;
    return {
      start(reviewId, job) {
        if (opts.failToLaunch) throw new Error('reviewer unavailable');
        started.push({ reviewId, script: job.script });
      },
      stop() {},
    };
  };
  const emit = () => {
    if (!listener) throw new Error('reviewer not wired');
    return listener;
  };
  const scriptOf = (reviewId: string) => started.find((s) => s.reviewId === reviewId)?.script ?? [];
  return {
    factory,
    started,
    finding(reviewId: string, position: number) {
      emit().onFinding(reviewId, position, scriptOf(reviewId)[position] ?? FALLBACK_FINDING);
    },
    complete(reviewId: string) {
      emit().onCompleted(reviewId);
    },
    fail(reviewId: string) {
      emit().onFailed(reviewId, 'boom');
    },
  };
}

const FALLBACK_FINDING: Finding = {
  clause: '1',
  title: 'Scripted finding',
  severity: 'low',
  excerpt: null,
  explanation: 'Used when the test emits a finding beyond the document script.',
};

/** Returns the given values in order, then repeats the last one. */
export function scriptedRng(...values: number[]): Rng {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

export function setup(
  opts: {
    startMs?: number;
    dbPath?: string;
    deadlineTimers?: boolean;
    /** Wraps the virtual scheduler, e.g. to make a timer fire early. */
    scheduler?: (time: VirtualTime) => Scheduler;
    rng?: Rng;
    reviewer?: ReturnType<typeof manualReviewer>;
    useFakeReviewer?: boolean;
    /** Any other simulated reviewer, on the test's virtual time. */
    reviewerFactory?: (time: VirtualTime) => ReviewerFactory;
    /** Switches Claude on: the reviewer behind it (a manual reviewer, or Claude with a scripted client). */
    claudeReviewerFactory?: (time: VirtualTime) => ReviewerFactory;
    /** Settings that differ from TEST_CONFIG. */
    config?: Partial<AppConfig>;
  } = {},
) {
  const time = new VirtualTime(opts.startMs ?? T0);
  const reviewer = opts.reviewer ?? manualReviewer();
  const server = createServer({
    dbPath: opts.dbPath ?? ':memory:',
    samplesDir: SAMPLES_DIR,
    config: { ...TEST_CONFIG, ...opts.config },
    clock: time,
    scheduler: opts.deadlineTimers === false ? noTimers : (opts.scheduler?.(time) ?? time),
    rng: opts.rng,
    reviewerFactory: opts.reviewerFactory?.(time) ?? (opts.useFakeReviewer ? undefined : reviewer.factory),
    claudeReviewerFactory: opts.claudeReviewerFactory?.(time),
  });
  const http = request(server.app);

  // Review requests need the requesting lawyer's live session. The helper keeps one per lawyer,
  // heartbeats it, and claims a new one if virtual time has let it expire.
  const tokens = new Map<string, string>();
  const sessionFor = async (lawyerId: string) => {
    const known = tokens.get(lawyerId);
    if (known && (await http.put('/api/sessions/current').set('Authorization', `Bearer ${known}`)).status === 200) {
      return known;
    }
    const res = await http.post('/api/sessions').send({ lawyerId });
    if (res.status !== 201) throw new Error(`no session for ${lawyerId}: ${res.status} ${JSON.stringify(res.body)}`);
    tokens.set(lawyerId, res.body.token);
    return res.body.token as string;
  };

  /** `reviewer` is the AI chosen in the app; without it the request body has none, as from an older client. */
  const requestReview = async (documentId: string, requestedBy = LAWYER.elena, reviewer?: ReviewerKind) => {
    const token = await sessionFor(requestedBy);
    return http
      .post(`/api/documents/${documentId}/reviews`)
      .set('Authorization', `Bearer ${token}`)
      .send(reviewer ? { reviewer } : {});
  };

  /** Starts a review that must be admitted and returns its id. */
  const startReview = async (documentId: string, requestedBy = LAWYER.elena, reviewer?: ReviewerKind) => {
    const res = await requestReview(documentId, requestedBy, reviewer);
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.id as string;
  };

  /**
   * Requests and completes one review per document, 1s apart, to set a test up (such as using up
   * a month's plan). It calls the domain directly, not HTTP: every HTTP request in a test takes a
   * local port that stays blocked for about 30 s after it closes, and a plan of 1,000 reviews would
   * use up all of them, failing whatever runs next. The HTTP routes are tested everywhere else.
   */
  const completeReviews = async (documentIds: string[], requestedBy = LAWYER.elena) => {
    for (const documentId of documentIds) {
      const result = server.service.requestReview(documentId, requestedBy);
      if (!result.ok) throw new Error(`expected the review of ${documentId} to be admitted, got ${result.error}`);
      time.advanceBy(1_000);
      reviewer.complete(result.review.id);
    }
  };

  const plan = async () => (await http.get(`/api/workspaces/${WORKSPACE}/plan`)).body;
  const documents = async () => (await http.get(`/api/workspaces/${WORKSPACE}/documents`)).body;
  const review = async (id: string) => (await http.get(`/api/reviews/${id}`)).body;
  const storedStatus = (id: string) => server.repo.getReview(id)?.status;

  return {
    time,
    reviewer,
    server,
    http,
    requestReview,
    startReview,
    completeReviews,
    plan,
    documents,
    review,
    storedStatus,
  };
}
