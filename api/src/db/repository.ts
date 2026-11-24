import type { Db } from './connection';
import type { FailureReason, Finding, Lawyer, ReviewerKind, ReviewStatus, Severity } from '../domain/types';
import type { MonthWindow } from '../domain/quota';

export interface DocumentRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  title: string;
  type: string;
  pages: number;
  uploaded_at: string;
  uploaded_by: string;
  supersedes: string | null;
  superseded_by: string | null;
}

export type LawyerRow = Omit<Lawyer, 'workspaces'>;

export interface WorkspaceRow {
  id: string;
  name: string;
}

export interface MembershipRow {
  lawyer_id: string;
  workspace_id: string;
  workspace_name: string;
}

export interface ReviewRow {
  id: string;
  document_id: string;
  requested_by: string;
  requested_at_ms: number;
  deadline_at_ms: number;
  status: ReviewStatus;
  reviewer: ReviewerKind;
  finished_at_ms: number | null;
  failure_reason: FailureReason | null;
}

/** A review as it is admitted: its deadline is fixed now, from the setting in force. */
export interface NewReview {
  id: string;
  documentId: string;
  requestedBy: string;
  requestedAtMs: number;
  deadlineAtMs: number;
  reviewer: ReviewerKind;
}

export interface ReviewRowWithCount extends ReviewRow {
  findings_count: number;
}

export interface ReviewFindingRow {
  position: number;
  clause: string | null;
  title: string;
  severity: Severity;
  excerpt: string | null;
  explanation: string;
  received_at_ms: number;
}

/**
 * Every query the app runs, as typed functions. Domain code never touches the driver.
 *
 * The guarded writes (`*IfLive`) are the core of the deadline rule: each one only affects a row
 * that is still in progress AND whose deadline (`deadline_at_ms`, stored when the review was
 * requested) has not passed according to `nowMs` — the application clock, bound as a parameter.
 * When the guard fails the write affects 0 rows and the caller discards the event.
 */
export function createRepository(db: Db) {
  const documentColumns = `d.id, d.workspace_id, w.name AS workspace_name, d.title, d.type, d.pages, d.uploaded_at,
    d.uploaded_by, d.supersedes,
    (SELECT n.id FROM documents n WHERE n.supersedes = d.id ORDER BY n.uploaded_at DESC LIMIT 1) AS superseded_by`;
  const documentsWithWorkspace = `documents d JOIN workspaces w ON w.id = d.workspace_id`;
  const findingsCount = `(SELECT COUNT(*) FROM review_findings f WHERE f.review_id = r.id) AS findings_count`;

  const q = {
    listLawyers: db.prepare<[], LawyerRow>(`SELECT id, name, title FROM lawyers ORDER BY name`),
    getLawyer: db.prepare<[string], LawyerRow>(`SELECT id, name, title FROM lawyers WHERE id = ?`),
    memberships: db.prepare<[], MembershipRow>(
      `SELECT m.lawyer_id, w.id AS workspace_id, w.name AS workspace_name
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id ORDER BY w.name`,
    ),
    getWorkspace: db.prepare<[string], WorkspaceRow>(`SELECT id, name FROM workspaces WHERE id = ?`),
    workspaceMembers: db.prepare<[string], LawyerRow>(
      `SELECT l.id, l.name, l.title FROM workspace_members m JOIN lawyers l ON l.id = m.lawyer_id
       WHERE m.workspace_id = ? ORDER BY l.name`,
    ),
    isMember: db.prepare<[string, string], { one: number }>(
      `SELECT 1 AS one FROM workspace_members WHERE workspace_id = ? AND lawyer_id = ?`,
    ),
    listDocuments: db.prepare<[string], DocumentRow>(
      `SELECT ${documentColumns} FROM ${documentsWithWorkspace} WHERE d.workspace_id = ? ORDER BY d.uploaded_at DESC`,
    ),
    getDocument: db.prepare<[string], DocumentRow>(
      `SELECT ${documentColumns} FROM ${documentsWithWorkspace} WHERE d.id = ?`,
    ),
    getScript: db.prepare<[string], Finding>(
      `SELECT clause, title, severity, excerpt, explanation FROM document_findings
       WHERE document_id = ? ORDER BY position`,
    ),
    getContract: db.prepare<[string], { client: string | null; body: string }>(
      `SELECT client, body FROM document_contracts WHERE document_id = ?`,
    ),
    getReview: db.prepare<[string], ReviewRow>(`SELECT * FROM reviews WHERE id = ?`),
    activeReview: db.prepare<[string], ReviewRow>(
      `SELECT * FROM reviews WHERE document_id = ? AND status = 'in_progress'`,
    ),
    reviewsOfDocument: db.prepare<[string], ReviewRow>(
      `SELECT * FROM reviews WHERE document_id = ? ORDER BY requested_at_ms DESC, rowid DESC`,
    ),
    latestReview: db.prepare<[string], ReviewRow>(
      `SELECT * FROM reviews WHERE document_id = ? ORDER BY requested_at_ms DESC, rowid DESC LIMIT 1`,
    ),
    latestCompletedReview: db.prepare<[string], ReviewRow>(
      `SELECT * FROM reviews WHERE document_id = ? AND status = 'completed'
       ORDER BY requested_at_ms DESC, rowid DESC LIMIT 1`,
    ),
    latestReviewPerDocument: db.prepare<[], ReviewRowWithCount>(
      `SELECT r.*, ${findingsCount} FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY requested_at_ms DESC, rowid DESC) AS rn
         FROM reviews
       ) r WHERE r.rn = 1`,
    ),
    latestCompletedReviewPerDocument: db.prepare<[], ReviewRowWithCount>(
      `SELECT r.*, ${findingsCount} FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY requested_at_ms DESC, rowid DESC) AS rn
         FROM reviews WHERE status = 'completed'
       ) r WHERE r.rn = 1`,
    ),
    reviewFindings: db.prepare<[string], ReviewFindingRow>(
      `SELECT position, clause, title, severity, excerpt, explanation, received_at_ms
       FROM review_findings WHERE review_id = ? ORDER BY position`,
    ),
    insertReview: db.prepare<[NewReview]>(
      `INSERT INTO reviews (id, document_id, requested_by, requested_at_ms, deadline_at_ms, reviewer, status)
       VALUES (@id, @documentId, @requestedBy, @requestedAtMs, @deadlineAtMs, @reviewer, 'in_progress')`,
    ),
    // The plan is per workspace: a review counts against the workspace that owns its document.
    usage: db.prepare<
      [{ workspaceId: string; startMs: number; endMs: number; nowMs: number }],
      { used: number; reserved: number }
    >(
      `SELECT
         COALESCE(SUM(r.status = 'completed'), 0) AS used,
         COALESCE(SUM(r.status = 'in_progress' AND @nowMs < r.deadline_at_ms), 0) AS reserved
       FROM reviews r JOIN documents d ON d.id = r.document_id
       WHERE d.workspace_id = @workspaceId AND r.requested_at_ms >= @startMs AND r.requested_at_ms < @endMs`,
    ),
    completeIfLive: db.prepare<[{ id: string; nowMs: number }]>(
      `UPDATE reviews SET status = 'completed', finished_at_ms = @nowMs
       WHERE id = @id AND status = 'in_progress' AND @nowMs < deadline_at_ms`,
    ),
    failIfLive: db.prepare<[{ id: string; reason: FailureReason; nowMs: number }]>(
      `UPDATE reviews SET status = 'failed', failure_reason = @reason, finished_at_ms = @nowMs
       WHERE id = @id AND status = 'in_progress' AND @nowMs < deadline_at_ms`,
    ),
    insertFindingIfLive: db.prepare(
      `INSERT INTO review_findings (review_id, position, clause, title, severity, excerpt, explanation, received_at_ms)
       SELECT id, @position, @clause, @title, @severity, @excerpt, @explanation, @nowMs FROM reviews
       WHERE id = @reviewId AND status = 'in_progress' AND @nowMs < deadline_at_ms
       ON CONFLICT (review_id, position) DO NOTHING`,
    ),
    // A timed-out review finished at its deadline, whenever the timeout is persisted.
    expireOneIfOverdue: db.prepare<[{ id: string; nowMs: number }]>(
      `UPDATE reviews SET status = 'failed', failure_reason = 'timeout', finished_at_ms = deadline_at_ms
       WHERE id = @id AND status = 'in_progress' AND @nowMs >= deadline_at_ms`,
    ),
    expireAllOverdue: db.prepare<[{ nowMs: number }]>(
      `UPDATE reviews SET status = 'failed', failure_reason = 'timeout', finished_at_ms = deadline_at_ms
       WHERE status = 'in_progress' AND @nowMs >= deadline_at_ms`,
    ),
    // Sessions: live while `@nowMs < last_seen_ms + @ttlMs`, on the injected clock like the deadline.
    sessionOf: db.prepare<[string], { token: string }>(`SELECT token FROM lawyer_sessions WHERE lawyer_id = ?`),
    deleteExpiredSession: db.prepare<[{ lawyerId: string; nowMs: number; ttlMs: number }]>(
      `DELETE FROM lawyer_sessions WHERE lawyer_id = @lawyerId AND @nowMs >= last_seen_ms + @ttlMs`,
    ),
    insertSession: db.prepare<[{ lawyerId: string; token: string; nowMs: number }]>(
      `INSERT INTO lawyer_sessions (lawyer_id, token, last_seen_ms) VALUES (@lawyerId, @token, @nowMs)`,
    ),
    touchLiveSession: db.prepare<[{ token: string; nowMs: number; ttlMs: number }], { lawyer_id: string }>(
      `UPDATE lawyer_sessions SET last_seen_ms = @nowMs
       WHERE token = @token AND @nowMs < last_seen_ms + @ttlMs RETURNING lawyer_id`,
    ),
    deleteSession: db.prepare<[string]>(`DELETE FROM lawyer_sessions WHERE token = ?`),
    liveLawyerIds: db.prepare<[{ nowMs: number; ttlMs: number }], { lawyer_id: string }>(
      `SELECT lawyer_id FROM lawyer_sessions WHERE @nowMs < last_seen_ms + @ttlMs`,
    ),
    interruptAllInProgress: db.prepare<[{ nowMs: number }]>(
      `UPDATE reviews SET status = 'failed', failure_reason = 'interrupted', finished_at_ms = @nowMs
       WHERE status = 'in_progress'`,
    ),
  };

  return {
    /** Runs `fn` in a BEGIN IMMEDIATE transaction: the write lock is taken up front. */
    immediateTransaction<T>(fn: () => T): T {
      return db.transaction(fn).immediate();
    },

    listLawyers: () => q.listLawyers.all(),
    getLawyer: (id: string) => q.getLawyer.get(id),
    memberships: () => q.memberships.all(),
    getWorkspace: (id: string) => q.getWorkspace.get(id),
    workspaceMembers: (workspaceId: string) => q.workspaceMembers.all(workspaceId),
    isMember: (workspaceId: string, lawyerId: string) => q.isMember.get(workspaceId, lawyerId) !== undefined,
    listDocuments: (workspaceId: string) => q.listDocuments.all(workspaceId),
    getDocument: (id: string) => q.getDocument.get(id),
    getFindingsScript: (documentId: string) => q.getScript.all(documentId),
    /** The contract text a real AI reads, and the firm's client; undefined if the document has none. */
    getContract: (documentId: string) => q.getContract.get(documentId),

    getReview: (id: string) => q.getReview.get(id),
    findActiveReview: (documentId: string) => q.activeReview.get(documentId),
    /** Every review of a document, newest first. */
    reviewsOfDocument: (documentId: string) => q.reviewsOfDocument.all(documentId),
    latestReview: (documentId: string) => q.latestReview.get(documentId),
    latestCompletedReview: (documentId: string) => q.latestCompletedReview.get(documentId),
    latestReviewPerDocument: () => q.latestReviewPerDocument.all(),
    latestCompletedReviewPerDocument: () => q.latestCompletedReviewPerDocument.all(),
    reviewFindings: (reviewId: string) => q.reviewFindings.all(reviewId),

    insertReview(review: NewReview) {
      q.insertReview.run(review);
    },

    /** For one workspace: used = completed; reserved = in progress and not past the deadline at `nowMs`. */
    usage(workspaceId: string, window: MonthWindow, nowMs: number) {
      return q.usage.get({ workspaceId, ...window, nowMs }) as { used: number; reserved: number };
    },

    completeIfLive: (id: string, nowMs: number) => q.completeIfLive.run({ id, nowMs }).changes === 1,
    failIfLive: (id: string, reason: FailureReason, nowMs: number) =>
      q.failIfLive.run({ id, reason, nowMs }).changes === 1,
    insertFindingIfLive: (reviewId: string, position: number, finding: Finding, nowMs: number) =>
      q.insertFindingIfLive.run({ reviewId, position, ...finding, nowMs }).changes === 1,

    expireIfOverdue: (id: string, nowMs: number) => q.expireOneIfOverdue.run({ id, nowMs }).changes === 1,
    expireAllOverdue: (nowMs: number) => q.expireAllOverdue.run({ nowMs }).changes,
    interruptAllInProgress: (nowMs: number) => q.interruptAllInProgress.run({ nowMs }).changes,

    /** The lawyer's session, live or not; claim() deletes an expired one first. */
    sessionToken: (lawyerId: string) => q.sessionOf.get(lawyerId)?.token,
    deleteExpiredSession: (lawyerId: string, nowMs: number, ttlMs: number) =>
      q.deleteExpiredSession.run({ lawyerId, nowMs, ttlMs }),
    insertSession: (lawyerId: string, token: string, nowMs: number) => q.insertSession.run({ lawyerId, token, nowMs }),
    /** Extends a live session; returns its lawyer, or undefined if the token is unknown or expired. */
    touchLiveSession: (token: string, nowMs: number, ttlMs: number) =>
      q.touchLiveSession.get({ token, nowMs, ttlMs })?.lawyer_id,
    deleteSession: (token: string) => q.deleteSession.run(token),
    liveLawyerIds: (nowMs: number, ttlMs: number) =>
      new Set(q.liveLawyerIds.all({ nowMs, ttlMs }).map((r) => r.lawyer_id)),
  };
}

export type Repository = ReturnType<typeof createRepository>;
