"use client";

import { useId } from "react";
import { setReviewerChoice, useReviewerChoice } from "@/lib/current-lawyer";
import { REVIEWER_LABEL } from "@/lib/format";
import { useSettings } from "@/lib/queries";
import type { ReviewerKind } from "@/lib/types";

/**
 * The AI that runs new reviews: the one last chosen in this browser, if this server offers it,
 * otherwise the simulated one. Claude is offered only when the API has an Anthropic API key
 * (ANTHROPIC_API_KEY), and the API refuses it otherwise anyway.
 */
export function useReviewer(): { reviewer: ReviewerKind; claudeOffered: boolean } {
  const { data: settings } = useSettings();
  const claudeOffered = !!settings?.reviewers.includes("claude");
  const chosen = useReviewerChoice();
  return { reviewer: chosen === "claude" && claudeOffered ? "claude" : "fake", claudeOffered };
}

const HINT: Record<ReviewerKind, string> = {
  fake: "Replays each document's scripted findings. Free.",
  claude: "Claude reads the contract: a real API call, paid per review.",
};

const NOT_OFFERED = "Claude needs an Anthropic API key on the server (ANTHROPIC_API_KEY).";

/**
 * Simulated AI or Claude, for new reviews. It appears in two places that show and change the same
 * choice: the header, compact, on every page; and the request box, with what each one costs.
 */
export function ReviewerSwitch({ variant, disabled = false }: { variant: "header" | "request"; disabled?: boolean }) {
  const { data: settings } = useSettings();
  const { reviewer, claudeOffered } = useReviewer();
  const name = useId(); // each switch is its own group of radio buttons
  const header = variant === "header";
  const limit = settings ? ` The same ${Math.round(settings.reviewDeadlineMs / 1000)}-second limit and plan apply.` : "";

  return (
    <fieldset
      disabled={disabled}
      className={header ? "flex items-center gap-1.5" : "mt-4 flex flex-wrap items-center gap-x-3 gap-y-2"}
    >
      <legend className="sr-only">{header ? "AI for new reviews" : "AI for this review"}</legend>
      <span aria-hidden="true" className={header ? "text-stone-500" : "text-sm font-medium text-stone-800"}>
        AI
      </span>
      <div className="inline-flex rounded-lg border border-stone-300 bg-stone-100 p-0.5">
        {(["fake", "claude"] as const).map((kind) => {
          const unavailable = kind === "claude" && !claudeOffered;
          const selected = reviewer === kind;
          return (
            <label
              key={kind}
              title={unavailable ? NOT_OFFERED : HINT[kind]}
              className={`rounded-md font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-500 ${
                header ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
              } ${
                selected
                  ? "bg-white text-stone-900 shadow-sm"
                  : unavailable
                    ? "cursor-not-allowed text-stone-400"
                    : "cursor-pointer text-stone-600 hover:text-stone-900"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={kind}
                className="sr-only"
                checked={selected}
                disabled={unavailable}
                onChange={() => setReviewerChoice(kind)}
              />
              {REVIEWER_LABEL[kind]}
            </label>
          );
        })}
      </div>
      {!header && (
        <p className="text-xs text-stone-600">
          {HINT[reviewer]}
          {reviewer === "claude" ? limit : ""}
          {claudeOffered ? "" : ` ${NOT_OFFERED}`}
        </p>
      )}
    </fieldset>
  );
}
