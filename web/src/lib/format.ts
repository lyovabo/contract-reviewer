import { useEffect, useState } from "react";
import type { FailureReason, ReviewerKind } from "./types";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
// The plan follows UTC calendar months, so its reset date is shown in UTC.
const utcDateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
const utcMonthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));
export const formatResetDate = (iso: string) => utcDateFormat.format(new Date(iso));
export const formatPlanMonth = (month: string) => utcMonthFormat.format(new Date(`${month}-01T00:00:00Z`));

export const REVIEWER_LABEL: Record<ReviewerKind, string> = { fake: "Simulated AI", claude: "Claude" };

export function secondsBetween(fromIso: string, toMs: number) {
  return Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 1000));
}

/**
 * A review's time limit in seconds, from the review itself (deadlineAt − requestedAt). The API
 * fixes each review's deadline when it is requested, so the app holds no number of its own.
 */
export function limitSeconds(review: { requestedAt: string; deadlineAt: string }) {
  return Math.round((new Date(review.deadlineAt).getTime() - new Date(review.requestedAt).getTime()) / 1000);
}

/** Why a review failed, in one sentence (the document page). */
export function failureCopy(reason: FailureReason, limit: number): string {
  switch (reason) {
    case "engine_error":
      return "The AI review stopped with an error.";
    case "timeout":
      return `The review did not finish within ${limit} seconds, so it was stopped.`;
    case "interrupted":
      return "The review was interrupted by a server restart.";
    case "launch_error":
      return "The review could not be started.";
  }
}

const RETRY = "Retry from the document page. A retry is a new review and uses a credit only if it completes.";

/**
 * What a failure means for the lawyer and what they can do next (the documents list's details).
 * Each reason has its own next step, so a future reason such as missing information can point
 * to "add it, then request a new review".
 */
export function failureDetails(reason: FailureReason, limit: number): { cause: string; nextStep: string } {
  switch (reason) {
    case "engine_error":
      return { cause: "The AI stopped with an error before finishing.", nextStep: RETRY };
    case "timeout":
      return { cause: `The review took longer than ${limit} seconds, so it was stopped.`, nextStep: RETRY };
    case "interrupted":
      return { cause: "The server restarted while the review was running.", nextStep: RETRY };
    case "launch_error":
      return { cause: "The review could not be started.", nextStep: RETRY };
  }
}

/** Current time, ticking every second while `active` (for elapsed-time displays). */
export function useNow(active: boolean, intervalMs = 1_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}
