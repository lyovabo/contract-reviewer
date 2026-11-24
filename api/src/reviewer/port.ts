import type { Finding } from '../domain/types';

/**
 * Events a reviewer emits. Only the domain layer applies them, always through guarded
 * conditional writes, so a late, duplicate or stale event can never change a finished review.
 */
export interface ReviewerListener {
  onFinding(reviewId: string, position: number, finding: Finding): void;
  onCompleted(reviewId: string): void;
  onFailed(reviewId: string, message: string): void;
}

/** Everything a reviewer may need for one review. Each implementation reads what it uses. */
export interface ReviewJob {
  /** client: the party the firm acts for, if known. */
  document: { title: string; type: string; client: string | null };
  /** The contract text (what the Claude reviewer reads); null if the document has none. */
  text: string | null;
  /** The scripted findings for this document (what the fake reviewer replays). */
  script: readonly Finding[];
}

/**
 * The AI reviewer boundary. It never touches the database and knows nothing about quotas,
 * deadlines or HTTP: it is given a review job and reports back events.
 */
export interface ReviewerPort {
  /** Fire and forget. May throw if the reviewer cannot be launched. */
  start(reviewId: string, job: ReviewJob): void;
  /** Drop every pending run (shutdown). */
  stop(): void;
}

export type ReviewerFactory = (listener: ReviewerListener) => ReviewerPort;
