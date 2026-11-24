import type { ReactNode } from "react";
import type { Finding, Severity } from "@/lib/types";

const SEVERITY_STYLE: Record<Severity, string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-900",
  low: "bg-stone-200 text-stone-700",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${SEVERITY_STYLE[severity]}`}>
      {severity}
    </span>
  );
}

export function SeveritySummary({ findings }: { findings: Finding[] }) {
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  return (
    <p className="text-sm text-stone-600">
      {findings.length} {findings.length === 1 ? "finding" : "findings"}: {count("high")} high · {count("medium")} medium ·{" "}
      {count("low")} low
    </p>
  );
}

/**
 * `incomplete` marks findings that came from a review that did not finish. `tag` adds a label to
 * each finding, such as how it compares with the previous review.
 */
export function FindingsList<F extends Finding>({
  findings,
  incomplete = false,
  tag,
}: {
  findings: F[];
  incomplete?: boolean;
  tag?: (finding: F) => ReactNode;
}) {
  return (
    <ul className="space-y-3">
      {findings.map((finding) => (
        <li
          key={finding.position}
          className={`rounded-lg border p-4 ${incomplete ? "border-dashed border-red-300 bg-stone-50" : "border-stone-200 bg-white"}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <span className="font-mono text-xs text-stone-500">
              {finding.clause ? `Clause ${finding.clause}` : "General"}
            </span>
            {incomplete && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                Incomplete review
              </span>
            )}
            {tag?.(finding)}
          </div>
          <h4 className="mt-1.5 font-medium">{finding.title}</h4>
          {finding.excerpt && (
            <blockquote className="mt-2 border-l-2 border-stone-300 pl-3 text-sm italic text-stone-600">
              “{finding.excerpt}”
            </blockquote>
          )}
          <p className="mt-2 text-sm text-stone-700">{finding.explanation}</p>
        </li>
      ))}
    </ul>
  );
}
