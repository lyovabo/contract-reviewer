"use client";

import Link from "next/link";
import { useState } from "react";
import { SupersededBadge } from "@/components/DocumentReview";
import { PlanIndicator } from "@/components/PlanIndicator";
import { ReviewState, documentTypeLabel } from "@/components/StatusChip";
import { STATUS_FILTERS, filterDocuments, matchesStatus, type StatusFilter } from "@/lib/document-filter";
import { formatDate, useNow } from "@/lib/format";
import { useCurrentWorkspace, useDocuments, useLawyerName, useWorkspace } from "@/lib/queries";
import type { DocumentSummary, WorkspaceRef } from "@/lib/types";

export default function DocumentsPage() {
  // The gate guarantees a workspace here; the guard only keeps the types honest.
  const workspace = useCurrentWorkspace();
  return workspace ? <WorkspaceDocuments workspace={workspace} /> : null;
}

function WorkspaceDocuments({ workspace }: { workspace: WorkspaceRef }) {
  const { data: documents, error, isPending } = useDocuments(workspace.id);
  const { data: details } = useWorkspace(workspace.id);
  const lawyerName = useLawyerName();
  const now = useNow(!!documents?.some((d) => d.latestReview?.status === "in_progress"));
  const members = details?.members.map((m) => m.name);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const searchable = (doc: DocumentSummary) => [doc.title, documentTypeLabel(doc.type), lawyerName(doc.uploadedBy)];
  const visible = documents ? filterDocuments(documents, query, status, searchable) : [];
  const filtering = query.trim() !== "" || status !== "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 sm:flex-1">
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-stone-600">
            Owned by <strong className="font-medium text-stone-900">{workspace.name}</strong>
            {members ? `, shared by ${joinNames(members)}` : ""}. Each shows the state of its latest AI review.
          </p>
        </div>
        {/* Usage sits with the documents it is spent on. */}
        <PlanIndicator workspaceId={workspace.id} />
      </div>

      {documents && documents.length > 0 && (
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Search documents</span>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, type or uploader"
              className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none"
            />
          </label>
          <div role="group" aria-label="Filter by review status" className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => {
              const selected = status === filter.id;
              const count = documents.filter((doc) => matchesStatus(doc, filter.id)).length;
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setStatus(filter.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    selected
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-300 bg-white text-stone-700 hover:border-stone-500"
                  }`}
                >
                  {filter.label} <span className={`tabular-nums ${selected ? "text-stone-300" : "text-stone-400"}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isPending && <p className="text-stone-500">Loading…</p>}
      {error && <p className="text-red-700">Could not load documents: {error.message}</p>}
      {documents?.length === 0 && <p className="text-stone-500">This workspace has no documents yet.</p>}
      {documents && documents.length > 0 && visible.length === 0 && (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-600">
          No documents match.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setQuery("");
              setStatus("all");
            }}
          >
            Clear search and filters
          </button>
        </p>
      )}
      {filtering && visible.length > 0 && (
        <p className="text-xs text-stone-500" aria-live="polite">
          Showing {visible.length} of {documents?.length} documents
        </p>
      )}

      {visible.length > 0 && (
        // No overflow-hidden on the list: the status tooltips must be able to extend past it.
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
          {visible.map((doc) => (
            // The whole row opens the document (the title's link is stretched over it), while the
            // status "i" button sits above that link: a button may not be nested inside a link.
            <li
              key={doc.id}
              className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-3 first:rounded-t-xl last:rounded-b-xl hover:bg-stone-50"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <Link href={`/documents/${doc.id}`} className="after:absolute after:inset-0 after:content-['']">
                    {doc.title}
                  </Link>
                  {doc.supersededBy && <SupersededBadge />}
                </p>
                <p className="text-sm text-stone-500">
                  {documentTypeLabel(doc.type)} · {doc.pages} pages · uploaded {formatDate(doc.uploadedAt)} by{" "}
                  {lawyerName(doc.uploadedBy)}
                </p>
              </div>
              <ReviewState
                latest={doc.latestReview}
                lastCompleted={doc.lastCompletedReview}
                now={now}
                lawyerName={lawyerName}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13 13 4 4" strokeLinecap="round" />
    </svg>
  );
}

function joinNames(names: string[]) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
