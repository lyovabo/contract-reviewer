"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ApiError } from "@/lib/api";
import { formatDate, useNow } from "@/lib/format";
import { useCurrentLawyer, useDocument, useLawyerName, useRefreshReviewState } from "@/lib/queries";
import type { DocumentDetail } from "@/lib/types";
import { BackLink } from "./BackLink";
import { documentTypeLabel } from "./StatusChip";
import { RequestReview } from "./RequestReview";
import { ReviewHistoryButton } from "./ReviewHistory";
import { LatestReviewPanel, PreviousReviewPanel } from "./ReviewPanels";

/** Document page: request a review, follow it live, read the result. */
export function DocumentReview({ documentId }: { documentId: string }) {
  const { data: document, error, isPending } = useDocument(documentId);
  const lawyerName = useLawyerName();
  const lawyer = useCurrentLawyer();
  const latest = document?.latestReview ?? null;
  const now = useNow(latest?.status === "in_progress");
  useRefreshOnTransition(document);

  if (isPending) return <p className="text-stone-500">Loading…</p>;
  if (error || !document) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="space-y-3">
        <p>{notFound ? "This document does not exist." : `Could not load the document: ${error?.message}`}</p>
        <BackLink />
      </div>
    );
  }
  // Only possible with several workspaces: a link to a document owned by one you don't belong to.
  if (lawyer && !lawyer.workspaces.some((w) => w.id === document.workspace.id)) {
    return (
      <div className="space-y-3">
        <p>
          This document is owned by {document.workspace.name}, and {lawyer.name} is not a member of it.
        </p>
        <BackLink />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <BackLink />
          <ReviewHistoryButton documentId={document.id} hasReviews={latest !== null} />
        </div>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {document.title}
          {document.supersededBy && <SupersededBadge />}
        </h1>
        <p className="text-sm text-stone-500">
          Owned by <strong className="font-medium text-stone-700">{document.workspace.name}</strong> ·{" "}
          {documentTypeLabel(document.type)} · {document.pages} pages · uploaded {formatDate(document.uploadedAt)} by{" "}
          {lawyerName(document.uploadedBy)}
        </p>
        {document.supersededBy && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A newer version of this document has been uploaded. This one can still be reviewed.{" "}
            <Link href={`/documents/${document.supersededBy}`} className="font-medium underline">
              Open the newer version
            </Link>
          </p>
        )}
        {document.supersedes && (
          <p className="text-sm text-stone-500">
            Replaces an earlier version.{" "}
            <Link href={`/documents/${document.supersedes}`} className="underline">
              Open the earlier version
            </Link>
          </p>
        )}
      </div>

      <RequestReview document={document} />

      {latest ? (
        <LatestReviewPanel review={latest} lawyerName={lawyerName} now={now} />
      ) : (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-stone-500">
          This document has not been reviewed yet.
        </p>
      )}

      {latest && document.previousCompletedReview && (
        <>
          <hr className="border-stone-300" />
          <PreviousReviewPanel review={document.previousCompletedReview} latest={latest} />
        </>
      )}
    </div>
  );
}

export function SupersededBadge() {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Superseded</span>
  );
}

/** When the followed review changes (new review, or it finishes), refresh the plan and the list too. */
function useRefreshOnTransition(document: DocumentDetail | undefined) {
  const refresh = useRefreshReviewState();
  const previous = useRef<string | null>(null);
  const key = document ? `${document.latestReview?.id ?? "none"}:${document.latestReview?.status ?? "none"}` : null;
  useEffect(() => {
    if (!document || key === null) return;
    if (previous.current !== null && previous.current !== key) void refresh(document.id);
    previous.current = key;
  }, [key, document, refresh]);
}
