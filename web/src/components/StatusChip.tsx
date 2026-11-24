import { failureDetails, formatDate, formatDateTime, limitSeconds, secondsBetween } from "@/lib/format";
import type { ReviewSummary } from "@/lib/types";
import { InfoTip } from "./InfoTip";

const TYPE_LABELS: Record<string, string> = { nda: "NDA", saas: "SaaS", dpa: "DPA", ip: "IP" };

export function documentTypeLabel(type: string) {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

const CHIP = "whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium";
const GREEN = `${CHIP} bg-emerald-100 text-emerald-900`;

function resultLabel(review: ReviewSummary) {
  const findings =
    review.findingsCount === 0
      ? "no issues found"
      : `${review.findingsCount} ${review.findingsCount === 1 ? "finding" : "findings"}`;
  return `Reviewed ${formatDate(review.finishedAt ?? review.requestedAt)} · ${findings}`;
}

const resultSentence = (review: ReviewSummary) =>
  `The review from ${formatDate(review.finishedAt ?? review.requestedAt)} (${
    review.findingsCount === 0 ? "no issues found" : `${review.findingsCount} findings`
  }) is still the document's current result.`;

/**
 * A document's review state in the list: short chips on one line, always in the same place, with
 * the details behind an "i" tooltip. It leads with what the lawyer can rely on (the current
 * result, if any). A failed attempt that a later review completed is history and is not mentioned.
 */
export function ReviewState({
  latest,
  lastCompleted,
  now,
  lawyerName,
}: {
  latest: ReviewSummary | null;
  lastCompleted: ReviewSummary | null;
  now: number;
  lawyerName: (id: string) => string;
}) {
  if (!latest) return <span className={`${CHIP} bg-stone-100 text-stone-600`}>Not reviewed</span>;

  // A completed review older than the latest attempt: still the document's current result.
  const earlierResult = lastCompleted && lastCompleted.id !== latest.id ? lastCompleted : null;
  const requested = `Requested by ${lawyerName(latest.requestedBy)} on ${formatDateTime(latest.requestedAt)}, with ${
    latest.reviewer === "claude" ? "Claude" : "the simulated AI"
  }.`;

  switch (latest.status) {
    case "completed":
      return <span className={GREEN}>{resultLabel(latest)}</span>;

    case "in_progress":
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${CHIP} bg-sky-100 text-sky-900 tabular-nums`}>
            Review in progress · {Math.min(limitSeconds(latest), secondsBetween(latest.requestedAt, now))}s
          </span>
          <InfoTip label="Review in progress: details">
            <p className="font-semibold text-stone-900">Review in progress</p>
            <p>
              {requested} It stops if it has not finished within {limitSeconds(latest)} seconds.
            </p>
            <p>It uses one credit only if it completes.</p>
            {earlierResult && <p>{resultSentence(earlierResult)}</p>}
          </InfoTip>
        </div>
      );

    case "failed": {
      const details = latest.failureReason ? failureDetails(latest.failureReason, limitSeconds(latest)) : null;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {earlierResult && <span className={GREEN}>{resultLabel(earlierResult)}</span>}
          {/* The failure chip and its "i" wrap together, never apart. */}
          <span className="inline-flex items-center gap-1.5">
            {earlierResult ? (
              <span className={`${CHIP} bg-amber-100 text-amber-900`}>Newer review failed</span>
            ) : (
              <span className={`${CHIP} bg-red-100 text-red-800`}>Review failed · no result yet</span>
            )}
            <InfoTip label="Why the review failed" tone={earlierResult ? "warning" : "danger"}>
              <p className="font-semibold text-stone-900">
                {earlierResult ? "A newer review failed" : "The review failed"}
              </p>
              <p>{details?.cause ?? "The review failed."}</p>
              <p>{requested} No credit was used.</p>
              {earlierResult && <p>{resultSentence(earlierResult)}</p>}
              {details && (
                <p>
                  <span className="font-medium text-stone-900">Next step:</span> {details.nextStep}
                </p>
              )}
            </InfoTip>
          </span>
        </div>
      );
    }
  }
}
