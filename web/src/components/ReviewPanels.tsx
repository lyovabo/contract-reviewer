import { REVIEWER_LABEL, failureCopy, formatDate, formatDateTime, limitSeconds, secondsBetween } from "@/lib/format";
import type { Review } from "@/lib/types";
import { FindingsList, SeveritySummary } from "./Findings";

interface PanelProps {
  review: Review;
  lawyerName: (id: string) => string;
  now: number;
}

/** The latest review of a document. Only a completed review is ever styled as a final result. */
export function LatestReviewPanel(props: PanelProps) {
  switch (props.review.status) {
    case "in_progress":
      return <LiveReviewPanel {...props} />;
    case "failed":
      return <FailedReviewPanel {...props} />;
    case "completed":
      return <CompletedReviewPanel {...props} />;
  }
}

function LiveReviewPanel({ review, lawyerName, now }: PanelProps) {
  const limit = limitSeconds(review);
  const elapsed = Math.min(limit, secondsBetween(review.requestedAt, now));
  return (
    <section aria-label="Latest review" className="overflow-hidden rounded-xl border-2 border-sky-300 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-sky-100 px-4 py-2.5 text-sky-950">
        <h2 className="flex items-center gap-2 font-semibold">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-700 border-t-transparent" aria-hidden="true" />
          Review in progress — partial results
        </h2>
        <p className="text-sm tabular-nums">
          {elapsed}s elapsed · stops at {limit}s
        </p>
      </div>
      <div className="h-1 bg-sky-50" aria-hidden="true">
        <div className="h-1 bg-sky-500 transition-all" style={{ width: `${(elapsed / limit) * 100}%` }} />
      </div>
      <div className="space-y-3 p-4">
        <p className="text-sm text-sky-950">
          <strong>Not final.</strong> More findings may arrive, and the review can still fail. Requested by{" "}
          {lawyerName(review.requestedBy)} at {formatDateTime(review.requestedAt)} · {REVIEWER_LABEL[review.reviewer]}.
        </p>
        <FindingsList findings={review.findings} />
        <p className="animate-pulse text-sm text-stone-500">
          {review.findings.length === 0 ? "Waiting for the first findings…" : "Waiting for more findings…"}
        </p>
      </div>
    </section>
  );
}

function FailedReviewPanel({ review, lawyerName }: PanelProps) {
  const reason = review.failureReason ? failureCopy(review.failureReason, limitSeconds(review)) : "The review failed.";
  return (
    <section aria-label="Latest review" className="overflow-hidden rounded-xl border-2 border-red-300 bg-white">
      <div className="bg-red-50 px-4 py-2.5 text-red-900">
        <h2 className="font-semibold">Review failed</h2>
        <p className="text-sm">
          {reason} No credit was used. Requested by {lawyerName(review.requestedBy)} at {formatDateTime(review.requestedAt)} ·{" "}
          {REVIEWER_LABEL[review.reviewer]}.
        </p>
      </div>
      <div className="space-y-3 p-4">
        {review.findings.length > 0 ? (
          <>
            <p role="note" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              <strong>From a failed review — incomplete.</strong> These {review.findings.length} findings are what the AI
              returned before it failed. The document may have other issues: do not rely on this list.
            </p>
            <FindingsList findings={review.findings} incomplete />
          </>
        ) : (
          <p className="text-sm text-stone-600">
            The review returned no findings before it failed. This does not mean the document has no issues.
          </p>
        )}
      </div>
    </section>
  );
}

function CompletedReviewPanel({ review, lawyerName }: PanelProps) {
  return (
    <section aria-label="Latest review" className="overflow-hidden rounded-xl border-2 border-emerald-300 bg-white">
      <div className="bg-emerald-50 px-4 py-2.5 text-emerald-950">
        <h2 className="font-semibold">Review completed</h2>
        <p className="text-sm">
          Completed {formatDateTime(review.finishedAt ?? review.requestedAt)} · requested by {lawyerName(review.requestedBy)} ·{" "}
          {REVIEWER_LABEL[review.reviewer]}
        </p>
      </div>
      <div className="space-y-3 p-4">
        <ReviewFindings review={review} />
      </div>
    </section>
  );
}

/**
 * The last completed review, kept on screen while a newer review runs or after it failed, but
 * visually separated and badged so it can never be mistaken for the latest result.
 */
export function PreviousReviewPanel({ review, latest }: { review: Review; latest: Review }) {
  return (
    <section aria-label="Previous review" className="rounded-xl border border-stone-300 bg-stone-100 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-stone-700 px-2.5 py-0.5 text-xs font-semibold text-white">
          Previous review — completed {formatDate(review.finishedAt ?? review.requestedAt)} · {REVIEWER_LABEL[review.reviewer]}
        </span>
        <span className="text-sm text-stone-600">
          {latest.status === "in_progress"
            ? "Shown for reference while the new review runs. It is not the latest review."
            : "The latest review failed; this is the most recent completed review."}
        </span>
      </div>
      <ReviewFindings review={review} />
    </section>
  );
}

function ReviewFindings({ review }: { review: Review }) {
  if (review.findings.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="font-medium text-emerald-900">No issues found</p>
        <p className="text-sm text-emerald-900">The completed review flagged no clauses in this document.</p>
      </div>
    );
  }
  return (
    <>
      <SeveritySummary findings={review.findings} />
      <FindingsList findings={review.findings} />
    </>
  );
}
