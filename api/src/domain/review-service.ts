import { randomUUID } from 'node:crypto';
import type { DocumentRow, Repository, ReviewRow, ReviewRowWithCount } from '../db/repository';
import type { ReviewerFactory, ReviewerListener, ReviewerPort } from '../reviewer/port';
import { planUsage, quotaRefusal, utcMonthWindow, type PlanUsage } from './quota';
import { compareWithPrevious } from './review-history';
import { toIso, type Cancel, type Clock, type Scheduler } from './time';
import type {
  DocumentDetail,
  DocumentInfo,
  DocumentSummary,
  FailureReason,
  Finding,
  Lawyer,
  ReviewHistoryEntry,
  ReviewerKind,
  ReviewSummary,
  ReviewView,
  Workspace,
} from './types';

export interface Logger {
  info(message: string): void;
  error(message: string, err?: unknown): void;
}

export const silentLogger: Logger = { info: () => {}, error: () => {} };

export interface ReviewServiceDeps {
  repo: Repository;
  clock: Clock;
  scheduler: Scheduler;
  /** The simulated AI: always offered, and the default. */
  reviewerFactory: ReviewerFactory;
  /** Claude: offered only when given (the server has an Anthropic API key). */
  claudeReviewerFactory?: ReviewerFactory;
  /** A review still running this long after it was requested has failed for good (config.json). */
  reviewDeadlineMs: number;
  /** Reviews one workspace may complete per UTC calendar month (config.json). */
  monthlyReviewLimit: number;
  newId?: () => string;
  logger?: Logger;
}

export type RequestReviewResult =
  | { ok: true; review: ReviewView }
  | { ok: false; error: 'document_not_found' | 'unknown_lawyer' | 'not_a_member' | 'reviewer_unavailable' }
  | { ok: false; error: 'review_in_progress'; reviewId: string }
  | { ok: false; error: 'plan_exhausted' | 'slots_reserved'; plan: PlanUsage };

type Refusal = Exclude<RequestReviewResult, { ok: true }>;

/**
 * The only place review state changes. Owns the rules:
 * - admission (one in-progress review per document, monthly quota) in one immediate transaction
 * - the deadline: every reviewer event goes through a guarded write; a timer persists timeouts
 * - the restart policy
 */
export class ReviewService {
  private readonly repo: Repository;
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly reviewers: Partial<Record<ReviewerKind, ReviewerPort>>;
  private readonly newId: () => string;
  private readonly log: Logger;
  private readonly deadlineTimers = new Map<string, Cancel>();
  readonly reviewDeadlineMs: number;
  readonly monthlyReviewLimit: number;
  /** The AIs a lawyer can choose from: always the simulated one, and Claude if the server has a key. */
  readonly availableReviewers: ReviewerKind[];

  constructor(deps: ReviewServiceDeps) {
    this.repo = deps.repo;
    this.reviewDeadlineMs = deps.reviewDeadlineMs;
    this.monthlyReviewLimit = deps.monthlyReviewLimit;
    this.clock = deps.clock;
    this.scheduler = deps.scheduler;
    this.newId = deps.newId ?? randomUUID;
    this.log = deps.logger ?? silentLogger;
    // Both AIs report to the same listener: events are keyed by review id, and every one of them
    // goes through the same guarded writes, whichever AI sent it.
    const listener: ReviewerListener = {
      onFinding: (reviewId, position, finding) => this.applyFinding(reviewId, position, finding),
      onCompleted: (reviewId) => this.applyCompleted(reviewId),
      onFailed: (reviewId, message) => {
        this.log.info(`reviewer reported failure for ${reviewId}: ${message}`);
        this.applyFailure(reviewId, 'engine_error');
      },
    };
    this.reviewers = {
      fake: deps.reviewerFactory(listener),
      ...(deps.claudeReviewerFactory ? { claude: deps.claudeReviewerFactory(listener) } : {}),
    };
    this.availableReviewers = Object.keys(this.reviewers) as ReviewerKind[];
  }

  // ---------------------------------------------------------------------------------------------
  // Commands

  /**
   * Admission runs as ONE immediate transaction, in this order:
   *   1. persist overdue timeouts — so a retry just after the deadline isn't blocked by a row the deadline
   *      already failed but whose timer hasn't fired yet
   *   2. at most one in-progress review per document
   *   3. quota of the workspace that owns the document: used + reserved < limit
   *   4. insert the in-progress review (reserving a credit)
   * The reviewer is launched only after the commit. Only members of that workspace may request.
   * `reviewer` is the AI the lawyer chose; Claude is refused unless this server offers it.
   */
  requestReview(documentId: string, requestedBy: string, reviewer: ReviewerKind = 'fake'): RequestReviewResult {
    const document = this.repo.getDocument(documentId);
    if (!document) return { ok: false, error: 'document_not_found' };
    if (!this.repo.getLawyer(requestedBy)) return { ok: false, error: 'unknown_lawyer' };
    if (!this.repo.isMember(document.workspace_id, requestedBy)) return { ok: false, error: 'not_a_member' };
    const ai = this.reviewers[reviewer];
    if (!ai) return { ok: false, error: 'reviewer_unavailable' };
    const workspaceId = document.workspace_id;

    const nowMs = this.clock.now();
    let admitted: Refusal | { ok: true; id: string; deadlineAtMs: number };
    try {
      admitted = this.repo.immediateTransaction(() => {
        this.repo.expireAllOverdue(nowMs);

        const active = this.repo.findActiveReview(documentId);
        if (active) return { ok: false, error: 'review_in_progress', reviewId: active.id } as const;

        const plan = this.planAt(workspaceId, nowMs);
        const refusal = quotaRefusal(plan);
        if (refusal) return { ok: false, error: refusal, plan } as const;

        const id = this.newId();
        const deadlineAtMs = nowMs + this.reviewDeadlineMs; // fixed now; a later setting never moves it
        this.repo.insertReview({ id, documentId, requestedBy, requestedAtMs: nowMs, deadlineAtMs, reviewer });
        return { ok: true, id, deadlineAtMs } as const;
      });
    } catch (err) {
      // The partial unique index is the backstop if the check above ever regresses.
      const active = isUniqueViolation(err) ? this.repo.findActiveReview(documentId) : undefined;
      if (!active) throw err;
      return { ok: false, error: 'review_in_progress', reviewId: active.id };
    }
    if (!admitted.ok) return admitted;

    const reviewId = admitted.id;
    this.armDeadline(reviewId, admitted.deadlineAtMs);
    try {
      const contract = this.repo.getContract(documentId);
      ai.start(reviewId, {
        document: { title: document.title, type: document.type, client: contract?.client ?? null },
        text: contract?.body ?? null,
        script: this.repo.getFindingsScript(documentId),
      });
    } catch (err) {
      this.log.error(`could not launch reviewer for ${reviewId}`, err);
      this.applyFailure(reviewId, 'launch_error');
    }
    return { ok: true, review: this.getReview(reviewId)! };
  }

  /** Restart policy (assumes exactly one API process): nothing that was running can finish now. */
  startupSweep(): { timedOut: number; interrupted: number } {
    const nowMs = this.clock.now();
    return this.repo.immediateTransaction(() => ({
      timedOut: this.repo.expireAllOverdue(nowMs),
      interrupted: this.repo.interruptAllInProgress(nowMs),
    }));
  }

  dispose(): void {
    for (const ai of Object.values(this.reviewers)) ai.stop();
    for (const cancel of this.deadlineTimers.values()) cancel();
    this.deadlineTimers.clear();
  }

  // ---------------------------------------------------------------------------------------------
  // Reviewer events — each applied through a guarded write; whatever loses the race is discarded.

  applyFinding(reviewId: string, position: number, finding: Finding): boolean {
    const nowMs = this.clock.now();
    if (this.repo.insertFindingIfLive(reviewId, position, finding, nowMs)) return true;
    this.log.info(`discarded finding #${position} for ${reviewId}: review no longer live`);
    this.expireIfOverdue(reviewId, nowMs);
    return false;
  }

  applyCompleted(reviewId: string): boolean {
    const nowMs = this.clock.now();
    if (this.repo.completeIfLive(reviewId, nowMs)) {
      this.disarmDeadline(reviewId);
      return true;
    }
    this.log.info(`discarded completion for ${reviewId}: review no longer live`);
    this.expireIfOverdue(reviewId, nowMs);
    return false;
  }

  applyFailure(reviewId: string, reason: Exclude<FailureReason, 'timeout' | 'interrupted'>): boolean {
    const nowMs = this.clock.now();
    if (this.repo.failIfLive(reviewId, reason, nowMs)) {
      this.disarmDeadline(reviewId);
      return true;
    }
    this.log.info(`discarded failure (${reason}) for ${reviewId}: review no longer live`);
    this.expireIfOverdue(reviewId, nowMs);
    return false;
  }

  // ---------------------------------------------------------------------------------------------
  // Queries. Reads project overdue in-progress rows as failed('timeout') even before the timer
  // has persisted it, so no client ever sees a review "in progress" past its deadline.

  /** Every lawyer with the workspaces they belong to. */
  listLawyers(): Lawyer[] {
    const memberships = this.repo.memberships();
    return this.repo.listLawyers().map((lawyer) => ({
      ...lawyer,
      workspaces: memberships
        .filter((m) => m.lawyer_id === lawyer.id)
        .map((m) => ({ id: m.workspace_id, name: m.workspace_name })),
    }));
  }

  getWorkspace(workspaceId: string): Workspace | null {
    const workspace = this.repo.getWorkspace(workspaceId);
    return workspace ? { ...workspace, members: this.repo.workspaceMembers(workspaceId) } : null;
  }

  /** The monthly plan of one workspace; null if there is no such workspace. */
  getPlan(workspaceId: string): PlanUsage | null {
    return this.repo.getWorkspace(workspaceId) ? this.planAt(workspaceId, this.clock.now()) : null;
  }

  /** The documents a workspace owns; null if there is no such workspace. */
  listDocuments(workspaceId: string): DocumentSummary[] | null {
    if (!this.repo.getWorkspace(workspaceId)) return null;
    const nowMs = this.clock.now();
    const byDocument = (rows: ReviewRowWithCount[]) => new Map(rows.map((r) => [r.document_id, r]));
    const latest = byDocument(this.repo.latestReviewPerDocument());
    const lastCompleted = byDocument(this.repo.latestCompletedReviewPerDocument());
    const summary = (row: ReviewRowWithCount | undefined): ReviewSummary | null =>
      row ? { ...toReviewBase(row, nowMs), findingsCount: row.findings_count } : null;
    return this.repo.listDocuments(workspaceId).map((doc) => ({
      ...toDocumentInfo(doc),
      latestReview: summary(latest.get(doc.id)),
      lastCompletedReview: summary(lastCompleted.get(doc.id)),
    }));
  }

  getDocument(documentId: string): DocumentDetail | null {
    const doc = this.repo.getDocument(documentId);
    if (!doc) return null;
    const latest = this.repo.latestReview(documentId);
    const latestView = latest ? this.toReviewView(latest) : null;
    const previous =
      latestView && latestView.status !== 'completed' ? this.repo.latestCompletedReview(documentId) : undefined;
    return {
      ...toDocumentInfo(doc),
      latestReview: latestView,
      previousCompletedReview: previous ? this.toReviewView(previous) : null,
    };
  }

  /**
   * Every review of a document, newest first, each completed one compared with the previous
   * completed one (see review-history.ts). Null if there is no such document.
   */
  getReviewHistory(documentId: string): ReviewHistoryEntry[] | null {
    if (!this.repo.getDocument(documentId)) return null;
    return compareWithPrevious(this.repo.reviewsOfDocument(documentId).map((row) => this.toReviewView(row)));
  }

  getReview(reviewId: string): ReviewView | null {
    const row = this.repo.getReview(reviewId);
    return row ? this.toReviewView(row) : null;
  }

  // ---------------------------------------------------------------------------------------------

  private planAt(workspaceId: string, nowMs: number): PlanUsage {
    const window = utcMonthWindow(nowMs);
    const { used, reserved } = this.repo.usage(workspaceId, window, nowMs);
    return planUsage(workspaceId, window, used, reserved, this.monthlyReviewLimit);
  }

  private expireIfOverdue(reviewId: string, nowMs: number): void {
    if (this.repo.expireIfOverdue(reviewId, nowMs)) {
      this.log.info(`review ${reviewId} timed out`);
      this.disarmDeadline(reviewId);
    }
  }

  /** Persists the timeout promptly so polling clients see the failure at the deadline. */
  private armDeadline(reviewId: string, deadlineAtMs: number): void {
    const cancel = this.scheduler.schedule(() => {
      this.deadlineTimers.delete(reviewId);
      const nowMs = this.clock.now();
      this.expireIfOverdue(reviewId, nowMs);
      // A timer can fire a hair early against the wall clock; re-arm rather than leave it running.
      if (this.repo.getReview(reviewId)?.status === 'in_progress' && nowMs < deadlineAtMs) {
        this.armDeadline(reviewId, deadlineAtMs);
      }
    }, Math.max(1, deadlineAtMs - this.clock.now()));
    this.deadlineTimers.set(reviewId, cancel);
  }

  private disarmDeadline(reviewId: string): void {
    this.deadlineTimers.get(reviewId)?.();
    this.deadlineTimers.delete(reviewId);
  }

  private toReviewView(row: ReviewRow): ReviewView {
    const findings = this.repo.reviewFindings(row.id).map(({ received_at_ms, ...finding }) => ({
      ...finding,
      receivedAt: toIso(received_at_ms),
    }));
    return { ...toReviewBase(row, this.clock.now()), findings };
  }
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE';

function toDocumentInfo(doc: DocumentRow): DocumentInfo {
  return {
    id: doc.id,
    workspace: { id: doc.workspace_id, name: doc.workspace_name },
    title: doc.title,
    type: doc.type,
    pages: doc.pages,
    uploadedAt: doc.uploaded_at,
    uploadedBy: doc.uploaded_by,
    supersedes: doc.supersedes,
    supersededBy: doc.superseded_by,
  };
}

/** Maps a row to its client-facing state at `nowMs`, applying the deadline rule on read. */
function toReviewBase(row: ReviewRow, nowMs: number): Omit<ReviewSummary, 'findingsCount'> {
  const deadlineAtMs = row.deadline_at_ms;
  const overdue = row.status === 'in_progress' && nowMs >= deadlineAtMs;
  return {
    id: row.id,
    documentId: row.document_id,
    requestedBy: row.requested_by,
    requestedAt: toIso(row.requested_at_ms),
    deadlineAt: toIso(deadlineAtMs),
    status: overdue ? 'failed' : row.status,
    finishedAt: overdue ? toIso(deadlineAtMs) : row.finished_at_ms === null ? null : toIso(row.finished_at_ms),
    failureReason: overdue ? 'timeout' : row.failure_reason,
    reviewer: row.reviewer,
  };
}
