import type { DocumentSummary } from "./types";

export type StatusFilter = "all" | "reviewed" | "in_progress" | "failed" | "not_reviewed";

/**
 * Status filters, in the terms the list itself uses. They can overlap: a document whose
 * re-review failed has a result (Reviewed) and a failed latest attempt (Last review failed).
 */
export const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reviewed", label: "Reviewed" },
  { id: "in_progress", label: "In progress" },
  { id: "failed", label: "Last review failed" },
  { id: "not_reviewed", label: "Not reviewed" },
];

export function matchesStatus(doc: DocumentSummary, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "reviewed":
      return doc.lastCompletedReview !== null; // has a current result
    case "in_progress":
      return doc.latestReview?.status === "in_progress";
    case "failed":
      return doc.latestReview?.status === "failed";
    case "not_reviewed":
      return doc.latestReview === null;
  }
}

/** Case- and accent-insensitive ("societa" finds "Società"). */
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Every word of the query must appear somewhere in the document's searchable text. */
export function matchesQuery(searchable: string[], query: string): boolean {
  const haystack = fold(searchable.join(" "));
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function filterDocuments(
  documents: DocumentSummary[],
  query: string,
  status: StatusFilter,
  searchableText: (doc: DocumentSummary) => string[],
): DocumentSummary[] {
  return documents.filter((doc) => matchesStatus(doc, status) && matchesQuery(searchableText(doc), query));
}
