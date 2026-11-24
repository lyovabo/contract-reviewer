"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { ApiError, api } from "@/lib/api";
import { useCurrentLawyerId, useSessionToken } from "@/lib/current-lawyer";
import { formatPlanMonth, formatResetDate } from "@/lib/format";
import { useLawyerName, useLawyers, usePlan, useRefreshReviewState } from "@/lib/queries";
import type { DocumentDetail, Plan } from "@/lib/types";
import { PlanIndicator } from "./PlanIndicator";
import { ReviewerSwitch, useReviewer } from "./ReviewerSwitch";

function exhaustedCopy(plan: Plan): ReactNode {
  return (
    <>
      All {plan.limit} reviews in the {formatPlanMonth(plan.month)} plan are used. Requests are not queued: the plan
      resets on {formatResetDate(plan.resetsAt)}.{" "}
      <Link href="/upgrade" className="font-medium underline">
        Get more reviews
      </Link>
    </>
  );
}

const SLOTS_RESERVED_COPY =
  "The remaining credits are held by reviews in progress. They come back if those reviews fail, so try again in a moment.";

/**
 * The request button, with the choice of AI. It states the cost before anyone clicks, and when a
 * request cannot be made it says exactly why. The server stays authoritative: its refusals are
 * shown the same way.
 */
export function RequestReview({ document }: { document: DocumentDetail }) {
  const lawyerId = useCurrentLawyerId();
  const token = useSessionToken();
  const { data: lawyers } = useLawyers();
  const { data: plan } = usePlan(document.workspace.id); // reviews count against the owning workspace
  const lawyerName = useLawyerName();
  const refresh = useRefreshReviewState();
  const latest = document.latestReview;

  const { reviewer } = useReviewer(); // the same choice as the switch in the header

  const mutation = useMutation({
    // The server records the session's lawyer as the requester.
    mutationFn: () => api.requestReview(document.id, token!, reviewer),
    onSettled: () => refresh(document.id),
  });

  const lawyerKnown = !!lawyers?.some((l) => l.id === lawyerId);
  let blocked: ReactNode = null;
  if (!lawyerKnown) blocked = "Choose who you are before requesting a review.";
  else if (latest?.status === "in_progress")
    blocked = `A review of this document is already running, requested by ${lawyerName(latest.requestedBy)}. Only one review per document can run at a time.`;
  else if (plan && plan.available === 0) blocked = plan.used >= plan.limit ? exhaustedCopy(plan) : SLOTS_RESERVED_COPY;

  const label =
    latest?.status === "failed" ? "Retry review" : latest?.status === "completed" ? "Run a new review" : "Request AI review";

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-wrap items-center gap-4 sm:flex-1">
          <button
            type="button"
            className="rounded-lg bg-stone-900 px-4 py-2 font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600"
            disabled={!!blocked || mutation.isPending}
            onClick={() => {
              mutation.reset();
              mutation.mutate();
            }}
          >
            {mutation.isPending ? "Requesting…" : label}
          </button>
          <p className="text-sm text-stone-600">
            <strong className="font-medium text-stone-800">Uses one credit if the review completes.</strong> Failed
            reviews are free{latest?.status === "failed" ? "; a retry is a new review" : ""}.
          </p>
        </div>
        {/* Usage, shown before anyone clicks: the plan of the workspace that owns this document. */}
        <PlanIndicator workspaceId={document.workspace.id} />
      </div>
      <ReviewerSwitch variant="request" disabled={mutation.isPending} />
      {blocked && <p className="mt-3 text-sm text-stone-700">{blocked}</p>}
      {mutation.error && !blocked && <RequestError error={mutation.error} plan={plan} />}
      {mutation.error instanceof ApiError && mutation.error.code === "review_in_progress" && (
        <p className="mt-3 text-sm text-sky-800">A colleague started a review of this document just before you: it is shown below.</p>
      )}
    </div>
  );
}

function RequestError({ error, plan }: { error: Error; plan: Plan | undefined }) {
  if (error instanceof ApiError) {
    if (error.code === "reviewer_unavailable")
      return (
        <p className="mt-3 text-sm text-red-800">
          Claude is not available: the server has no Anthropic API key. Choose the simulated AI and try again.
        </p>
      );
    if (error.code === "review_in_progress") return null; // explained above, and the review is now on screen
    if (error.code === "plan_exhausted" && plan) return <p className="mt-3 text-sm text-red-800">{exhaustedCopy(plan)}</p>;
    if (error.code === "slots_reserved") return <p className="mt-3 text-sm text-red-800">{SLOTS_RESERVED_COPY}</p>;
    if (error.code === "session_expired" || error.code === "session_required")
      return (
        <p className="mt-3 text-sm text-red-800">
          Your session ended (the tab was idle or offline). It is being renewed; try again in a few seconds.
        </p>
      );
    if (error.code === "not_a_member")
      return <p className="mt-3 text-sm text-red-800">Only members of this document&apos;s workspace can request a review.</p>;
  }
  return <p className="mt-3 text-sm text-red-800">Could not request the review: {error.message}</p>;
}
