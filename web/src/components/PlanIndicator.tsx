"use client";

import Link from "next/link";
import { formatPlanMonth, formatResetDate } from "@/lib/format";
import { usePlan } from "@/lib/queries";

const TONE = {
  green: "bg-emerald-600 text-white",
  yellow: "bg-amber-400 text-amber-950",
  red: "bg-red-600 text-white",
};

/**
 * The workspace's remaining reviews this month: green > 3, yellow ≤ 3, red at 0 (with the reason
 * it is 0). Shown wherever a review can be requested: beside the documents list and in each
 * document's request box.
 */
export function PlanIndicator({ workspaceId }: { workspaceId: string }) {
  const { data: plan } = usePlan(workspaceId);
  if (!plan) return <div className="h-10 w-48" aria-busy="true" />;

  const tone = plan.available === 0 ? "red" : plan.available <= 3 ? "yellow" : "green";
  const exhausted = plan.used >= plan.limit;
  const resets = formatResetDate(plan.resetsAt);

  return (
    <div className="flex shrink-0 items-center gap-3" data-testid="plan-indicator">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold tabular-nums ${TONE[tone]}`}
        aria-hidden="true"
      >
        {plan.available}
      </span>
      <div className="text-sm leading-tight">
        <p className="font-medium">
          {plan.available} of {plan.limit} reviews left in {formatPlanMonth(plan.month)}
        </p>
        {plan.available === 0 && exhausted ? (
          <p className="text-red-700">
            Plan used up · resets {resets} ·{" "}
            <Link href="/upgrade" className="underline">
              Get more reviews
            </Link>
          </p>
        ) : plan.available === 0 ? (
          <p className="text-red-700">Remaining credits are held by running reviews · may free up shortly</p>
        ) : (
          <p className={tone === "yellow" ? "text-amber-800" : "text-stone-500"}>
            {tone === "yellow" ? "Running low · " : ""}
            {plan.reserved > 0 ? `${plan.reserved} held by running reviews · ` : ""}resets {resets}
          </p>
        )}
      </div>
    </div>
  );
}
