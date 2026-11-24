// Mirrors the API's JSON (api/src/domain/types.ts and quota.ts).

export type Severity = "high" | "medium" | "low";
export type ReviewStatus = "in_progress" | "completed" | "failed";
export type FailureReason = "engine_error" | "timeout" | "interrupted" | "launch_error";
/** Which AI ran a review: the simulated one, or Claude (a real, paid API call). */
export type ReviewerKind = "fake" | "claude";

/** The API's settings (api/config.json) that the app shows and follows. */
export interface Settings {
  reviewDeadlineMs: number;
  monthlyReviewLimit: number;
  sessionTtlMs: number;
  /** The AIs this server offers: always "fake", and "claude" when it has an Anthropic API key. */
  reviewers: ReviewerKind[];
}

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
  /** Someone has a live session as this lawyer (possibly this browser). */
  inUse: boolean;
}

export interface Session {
  token: string;
  lawyerId: string;
  ttlMs: number;
}

export interface Workspace extends WorkspaceRef {
  members: Omit<Lawyer, "workspaces" | "inUse">[];
}

export interface Finding {
  position: number;
  clause: string | null;
  title: string;
  severity: Severity;
  excerpt: string | null;
  explanation: string;
  receivedAt: string;
}

interface ReviewBase {
  id: string;
  documentId: string;
  requestedBy: string;
  requestedAt: string;
  deadlineAt: string;
  status: ReviewStatus;
  finishedAt: string | null;
  failureReason: FailureReason | null;
  reviewer: ReviewerKind;
}

export interface ReviewSummary extends ReviewBase {
  findingsCount: number;
}

export interface Review extends ReviewBase {
  findings: Finding[];
}

/** How a finding compares with the previous completed review of the same document. */
export type FindingChange = "new" | "unchanged";

export interface HistoryFinding extends Finding {
  /** null when the review is not compared: it is the first completed one, or it did not complete. */
  change: FindingChange | null;
}

/** One review in a document's history (GET /api/documents/:id/reviews), newest first. */
export interface ReviewHistoryEntry extends ReviewBase {
  findings: HistoryFinding[];
  /** The previous completed review this one is compared with; null if it is not compared. */
  comparedWith: { id: string; requestedAt: string } | null;
  /** The findings of that previous review that this one did not report. */
  noLongerFlagged: Finding[];
}

export interface DocumentInfo {
  id: string;
  /** The workspace that owns the document; its reviews count against that workspace's plan. */
  workspace: WorkspaceRef;
  title: string;
  type: string;
  pages: number;
  uploadedAt: string;
  uploadedBy: string;
  supersedes: string | null;
  supersededBy: string | null;
}

export interface DocumentSummary extends DocumentInfo {
  /** The most recent attempt, whatever its outcome. */
  latestReview: ReviewSummary | null;
  /** The most recent completed review (the document's current result); may equal latestReview. */
  lastCompletedReview: ReviewSummary | null;
}

export interface DocumentDetail extends DocumentInfo {
  latestReview: Review | null;
  previousCompletedReview: Review | null;
}

export interface Plan {
  workspaceId: string;
  month: string;
  limit: number;
  used: number;
  reserved: number;
  available: number;
  resetsAt: string;
}
