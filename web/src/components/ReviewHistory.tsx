"use client";

import Link from "next/link";
import { ApiError } from "@/lib/api";
import { REVIEWER_LABEL, failureCopy, formatDateTime, limitSeconds } from "@/lib/format";
import { useDocument, useLawyerName, useReviewHistory } from "@/lib/queries";
import type { HistoryFinding, ReviewHistoryEntry } from "@/lib/types";
import { FindingsList, SeveritySummary } from "./Findings";

const BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium";

/**
 * The way to a document's review history, at the top of its page. Clickable once the document has
 * been reviewed at least once; before that it is greyed out and says why.
 */
export function ReviewHistoryButton({ documentId, hasReviews }: { documentId: string; hasReviews: boolean }) {
  if (!hasReviews) {
    return (
      <button
        type="button"
        disabled
        title="No reviews yet: the history starts with the first review."
        className={`${BUTTON} cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400`}
      >
        <HistoryIcon />
        Review history
      </button>
    );
  }
  return (
    <Link
      href={`/documents/${documentId}/history`}
      className={`${BUTTON} border-stone-300 bg-white text-stone-900 hover:border-stone-500 hover:bg-stone-50`}
    >
      <HistoryIcon />
      Review history
    </Link>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6M3.5 3.5v3h3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 6.5V10l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Every review of one document, newest first. Each completed review is compared with the previous
 * completed one: its findings are tagged New or Also found before, and what it no longer flags is
 * listed. A failed or running review is shown with its findings labeled incomplete, and is not
 * compared, so nothing looks dropped that the review never reached.
 */
export function ReviewHistory({ documentId }: { documentId: string }) {
  const { data: document } = useDocument(documentId);
  const { data: reviews, error, isPending } = useReviewHistory(documentId);
  const lawyerName = useLawyerName();
  const back = (
    <Link
      href={`/documents/${documentId}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-900 hover:border-stone-500 hover:bg-stone-50"
    >
      <span aria-hidden="true">←</span> Back to the document
    </Link>
  );

  if (isPending) return <p className="text-stone-500">Loading…</p>;
  if (error || !reviews) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="space-y-3">
        <p>{notFound ? "This document does not exist." : `Could not load the review history: ${error?.message}`}</p>
        {back}
      </div>
    );
  }

  // The document's current result: its most recent completed review.
  const currentId = reviews.find((review) => review.status === "completed")?.id;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {back}
        <h1 className="text-2xl font-semibold">Review history</h1>
        <p className="text-sm text-stone-500">
          {document?.title ?? "This document"} · {reviews.length} {reviews.length === 1 ? "review" : "reviews"}, newest
          first. Each completed review is compared with the completed one before it.
        </p>
      </div>
      {reviews.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-stone-500">
          This document has not been reviewed yet.
        </p>
      ) : (
        <ol className="space-y-4" aria-label="Reviews, newest first">
          {reviews.map((review, index) => (
            <HistoryEntry
              key={review.id}
              review={review}
              current={review.id === currentId}
              open={index === 0}
              lawyerName={lawyerName}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

const STATUS = {
  completed: { label: "Completed", style: "bg-emerald-100 text-emerald-900", border: "border-emerald-300" },
  failed: { label: "Failed", style: "bg-red-100 text-red-800", border: "border-red-300" },
  in_progress: { label: "In progress", style: "bg-sky-100 text-sky-900", border: "border-sky-300" },
} as const;

function HistoryEntry(props: {
  review: ReviewHistoryEntry;
  current: boolean;
  open: boolean;
  lawyerName: (id: string) => string;
}) {
  const { review, current, open, lawyerName } = props;
  const status = STATUS[review.status];
  const count = review.findings.length;
  const findingsLabel =
    review.status === "completed"
      ? count === 0
        ? "No issues found"
        : `${count} ${count === 1 ? "finding" : "findings"}`
      : `${count} ${count === 1 ? "finding" : "findings"} ${review.status === "failed" ? "before it failed" : "so far"}`;

  return (
    <li aria-label={`Review of ${formatDateTime(review.requestedAt)}`}>
      <details open={open} className={`group overflow-hidden rounded-xl border bg-white ${status.border}`}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-stone-50">
          <span aria-hidden="true" className="text-stone-400 transition-transform group-open:rotate-90">
            ▸
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.style}`}>{status.label}</span>
          {current && (
            <span className="rounded-full bg-stone-800 px-2.5 py-0.5 text-xs font-semibold text-white">Current result</span>
          )}
          <span className="text-sm text-stone-700">
            {formatDateTime(review.requestedAt)} · {lawyerName(review.requestedBy)} · {REVIEWER_LABEL[review.reviewer]}
          </span>
          <span className="ml-auto text-sm font-medium text-stone-800">{findingsLabel}</span>
        </summary>
        <div className="space-y-3 border-t border-stone-200 p-4">
          <EntryNote review={review} />
          {count > 0 && (
            <>
              {review.status === "completed" && <SeveritySummary findings={review.findings} />}
              <FindingsList findings={review.findings} incomplete={review.status !== "completed"} tag={ChangeTag} />
            </>
          )}
          {review.noLongerFlagged.length > 0 && (
            <section aria-label="No longer flagged" className="space-y-2 pt-2">
              <h3 className="text-sm font-semibold text-stone-800">
                No longer flagged ({review.noLongerFlagged.length})
              </h3>
              <p className="text-sm text-stone-600">In the review before this one, but not in this one.</p>
              <div className="opacity-70">
                <FindingsList findings={review.noLongerFlagged} />
              </div>
            </section>
          )}
        </div>
      </details>
    </li>
  );
}

/** What the lawyer needs to know about this review before reading its findings. */
function EntryNote({ review }: { review: ReviewHistoryEntry }) {
  if (review.status === "in_progress") {
    return <p className="text-sm text-sky-900">Still running: these are partial results, and more may arrive.</p>;
  }
  if (review.status === "failed") {
    const reason = review.failureReason ? failureCopy(review.failureReason, limitSeconds(review)) : "The review failed.";
    return (
      <p className="text-sm text-red-900">
        {reason} No credit was used.{" "}
        {review.findings.length > 0
          ? "Its findings are what the AI returned before it failed: incomplete, and not compared with other reviews."
          : "It returned no findings before it failed. This does not mean the document has no issues."}
      </p>
    );
  }
  if (!review.comparedWith) {
    return <p className="text-sm text-stone-600">The first completed review of this document: nothing to compare with.</p>;
  }
  const isNew = review.findings.filter((f) => f.change === "new").length;
  const same = review.findings.filter((f) => f.change === "unchanged").length;
  return (
    <p className="text-sm text-stone-700">
      Compared with the review of {formatDateTime(review.comparedWith.requestedAt)}: <strong>{isNew} new</strong>,{" "}
      {same} also found before, {review.noLongerFlagged.length} no longer flagged.
    </p>
  );
}

function ChangeTag(finding: HistoryFinding) {
  if (finding.change === "new") {
    return <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-900">New</span>;
  }
  if (finding.change === "unchanged") {
    return <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">Also found before</span>;
  }
  return null;
}
