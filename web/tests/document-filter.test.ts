import { describe, expect, it } from "vitest";
import { filterDocuments, matchesQuery, matchesStatus } from "@/lib/document-filter";
import type { DocumentSummary, ReviewSummary } from "@/lib/types";

const review = (status: ReviewSummary["status"]): ReviewSummary => ({
  id: `r-${status}`,
  documentId: "d",
  requestedBy: "elena",
  requestedAt: "2026-11-12T09:00:00.000Z",
  deadlineAt: "2026-11-12T09:01:00.000Z",
  status,
  finishedAt: status === "in_progress" ? null : "2026-11-12T09:00:20.000Z",
  failureReason: status === "failed" ? "engine_error" : null,
  reviewer: "fake",
  findingsCount: 2,
});

const doc = (id: string, title: string, latest: ReviewSummary | null, lastCompleted: ReviewSummary | null): DocumentSummary => ({
  id,
  workspace: { id: "ws", name: "Firm workspace" },
  title,
  type: "lease",
  pages: 3,
  uploadedAt: "2026-09-01T00:00:00Z",
  uploadedBy: "elena",
  supersedes: null,
  supersededBy: null,
  latestReview: latest,
  lastCompletedReview: lastCompleted,
});

const neverReviewed = doc("a", "Office lease — 27 Albion Quay, Bristol", null, null);
const running = doc("b", "Master services agreement — Altamira Hotels", review("in_progress"), null);
const reviewed = doc("c", "Loan agreement — Meridian Credit Bank", review("completed"), review("completed"));
const failedRereview = doc("d", "Settlement agreement — Castellan Freight", review("failed"), review("completed"));
const failedOnly = doc("e", "Contrat de distribution — Brûlerie Montclair", review("failed"), null);
const all = [neverReviewed, running, reviewed, failedRereview, failedOnly];

const ids = (docs: DocumentSummary[]) => docs.map((d) => d.id);

describe("documents filter", () => {
  it("filters by status in the list's own terms, and a failed re-review counts as both reviewed and failed", () => {
    const byStatus = (s: Parameters<typeof matchesStatus>[1]) => ids(all.filter((d) => matchesStatus(d, s)));
    expect(byStatus("all")).toEqual(["a", "b", "c", "d", "e"]);
    expect(byStatus("reviewed")).toEqual(["c", "d"]); // has a current result
    expect(byStatus("in_progress")).toEqual(["b"]);
    expect(byStatus("failed")).toEqual(["d", "e"]); // latest attempt failed
    expect(byStatus("not_reviewed")).toEqual(["a"]);
  });

  it("search matches every word, ignoring case and accents, across title, type and uploader", () => {
    expect(matchesQuery(["Office lease — 27 Albion Quay, Bristol", "Lease", "Priya Raman"], "albion BRISTOL")).toBe(true);
    expect(matchesQuery(["Office lease — 27 Albion Quay, Bristol", "Lease", "Priya Raman"], "albion leeds")).toBe(false);
    expect(matchesQuery(["Contrat de distribution — Brûlerie Montclair"], "brulerie")).toBe(true);
    expect(matchesQuery(["anything"], "   ")).toBe(true); // an empty search shows everything
  });

  it("combines search and status", () => {
    const searchable = (d: DocumentSummary) => [d.title];
    expect(ids(filterDocuments(all, "agreement", "failed", searchable))).toEqual(["d"]);
    expect(ids(filterDocuments(all, "agreement", "all", searchable))).toEqual(["b", "c", "d"]);
    expect(filterDocuments(all, "nothing like this", "all", searchable)).toEqual([]);
  });
});
