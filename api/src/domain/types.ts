export type Severity = 'high' | 'medium' | 'low';

/** One flagged clause, as scripted in samples/documents.json and as returned by a review. */
export interface Finding {
  clause: string | null;
  title: string;
  severity: Severity;
  excerpt: string | null;
  explanation: string;
}

export type ReviewStatus = 'in_progress' | 'completed' | 'failed';

/**
 * Which AI ran a review, chosen per review by the lawyer who requests it.
 * - fake: the simulated AI, which replays each document's scripted findings (free; the default)
 * - claude: Claude reads the contract (a real API call, paid per review). Offered only when the
 *   server has an Anthropic API key (ANTHROPIC_API_KEY).
 */
export type ReviewerKind = 'fake' | 'claude';

export const REVIEWER_KINDS: readonly ReviewerKind[] = ['fake', 'claude'];

/**
 * Why a review failed. Every failure releases its credit.
 * - engine_error: the reviewer reported an error
 * - timeout: still in progress at its deadline (reviewDeadlineMs after it was requested)
 * - interrupted: the API restarted while it was running (the in-process reviewer died with it)
 * - launch_error: the reviewer could not be started
 */
export type FailureReason = 'engine_error' | 'timeout' | 'interrupted' | 'launch_error';

export interface WorkspaceRef {
  id: string;
  name: string;
}

/** A lawyer can be a member of several workspaces (the sample data has one). */
export interface Lawyer {
  id: string;
  name: string;
  title: string;
  workspaces: WorkspaceRef[];
}

export interface Workspace extends WorkspaceRef {
  members: Omit<Lawyer, 'workspaces'>[];
}

export interface DocumentInfo {
  id: string;
  /** The workspace that owns the document (and whose monthly plan its reviews count against). */
  workspace: WorkspaceRef;
  title: string;
  type: string;
  pages: number;
  uploadedAt: string;
  uploadedBy: string;
  supersedes: string | null;
  supersededBy: string | null;
}

export interface ReviewedFinding extends Finding {
  position: number;
  receivedAt: string;
}

export interface ReviewSummary {
  id: string;
  documentId: string;
  requestedBy: string;
  requestedAt: string;
  /** requestedAt + reviewDeadlineMs (60 s): the review fails if it has not completed by then. */
  deadlineAt: string;
  status: ReviewStatus;
  finishedAt: string | null;
  failureReason: FailureReason | null;
  /** Which AI ran it. */
  reviewer: ReviewerKind;
  findingsCount: number;
}

export interface ReviewView extends Omit<ReviewSummary, 'findingsCount'> {
  findings: ReviewedFinding[];
}

/** How a finding compares with the previous completed review of the same document. */
export type FindingChange = 'new' | 'unchanged';

export interface HistoryFinding extends ReviewedFinding {
  /** null when the review is not compared: it is the first completed one, or it did not complete. */
  change: FindingChange | null;
}

/** One review in a document's history (GET /api/documents/:id/reviews). */
export interface ReviewHistoryEntry extends Omit<ReviewView, 'findings'> {
  findings: HistoryFinding[];
  /** The previous completed review this one is compared with; null if it is not compared. */
  comparedWith: { id: string; requestedAt: string } | null;
  /** The findings of that previous review that this one did not report. */
  noLongerFlagged: ReviewedFinding[];
}

export interface DocumentSummary extends DocumentInfo {
  /** The most recent attempt, whatever its outcome. */
  latestReview: ReviewSummary | null;
  /** The most recent COMPLETED review: the document's current result. May be the same as latestReview. */
  lastCompletedReview: ReviewSummary | null;
}

export interface DocumentDetail extends DocumentInfo {
  latestReview: ReviewView | null;
  /**
   * The most recent completed review, returned only while the latest review is NOT completed
   * (running or failed), so the UI can keep the last final result on screen, labeled as previous.
   */
  previousCompletedReview: ReviewView | null;
}
