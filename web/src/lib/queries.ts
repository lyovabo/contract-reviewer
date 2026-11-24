"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useCurrentLawyerId, useCurrentWorkspaceId } from "./current-lawyer";
import type { WorkspaceRef } from "./types";

/** Poll fast while a review runs, slowly otherwise (to pick up the other lawyers' actions). */
export const FAST_POLL_MS = 1_000;
export const SLOW_POLL_MS = 5_000;

// `plan` and `documents` are prefixes: the full keys add the workspace id, so invalidating the
// prefix refreshes every workspace's entry.
export const queryKeys = {
  settings: ["settings"] as const,
  lawyers: ["lawyers"] as const,
  workspace: (id: string) => ["workspace", id] as const,
  plan: ["plan"] as const,
  documents: ["documents"] as const,
  document: (id: string) => ["document", id] as const,
  // Under the document's key, so refreshing the document refreshes its history too.
  history: (id: string) => ["document", id, "history"] as const,
};

/**
 * The API's settings. They only change when the API restarts, so they are fetched once. The
 * session heartbeat waits for them, so a failed request is retried every second until the API
 * answers (TanStack Query pauses retries while the tab is hidden, as the heartbeat does).
 */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.settings,
    staleTime: Infinity,
    retry: true,
    retryDelay: 1_000,
  });
}

export function useLawyers() {
  return useQuery({ queryKey: queryKeys.lawyers, queryFn: api.lawyers, staleTime: Infinity });
}

/** The lawyer picked on this browser, or null if none is picked (or the stored id is unknown). */
export function useCurrentLawyer() {
  const { data } = useLawyers();
  const id = useCurrentLawyerId();
  return data?.find((l) => l.id === id) ?? null;
}

/**
 * The workspace the current lawyer works in: the one they picked, or their only one. Null when
 * no lawyer is picked, or when a lawyer in several workspaces has not picked one yet.
 */
export function useCurrentWorkspace(): WorkspaceRef | null {
  const lawyer = useCurrentLawyer();
  const pickedId = useCurrentWorkspaceId();
  if (!lawyer) return null;
  const picked = lawyer.workspaces.find((w) => w.id === pickedId);
  if (picked) return picked;
  return lawyer.workspaces.length === 1 ? lawyer.workspaces[0]! : null;
}

export function useLawyerName() {
  const { data } = useLawyers();
  return (id: string | null | undefined) => data?.find((l) => l.id === id)?.name ?? "a colleague";
}

export function useWorkspace(id: string) {
  return useQuery({ queryKey: queryKeys.workspace(id), queryFn: () => api.workspace(id), staleTime: Infinity });
}

export function usePlan(workspaceId: string) {
  return useQuery({
    queryKey: [...queryKeys.plan, workspaceId],
    queryFn: () => api.plan(workspaceId),
    refetchInterval: SLOW_POLL_MS,
  });
}

export function useDocuments(workspaceId: string) {
  return useQuery({
    queryKey: [...queryKeys.documents, workspaceId],
    queryFn: () => api.documents(workspaceId),
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.latestReview?.status === "in_progress") ? FAST_POLL_MS : SLOW_POLL_MS,
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: queryKeys.document(id),
    queryFn: () => api.document(id),
    refetchInterval: (query) =>
      query.state.data?.latestReview?.status === "in_progress" ? FAST_POLL_MS : SLOW_POLL_MS,
  });
}

/** A document's review history; polled like the document, fast while one of its reviews runs. */
export function useReviewHistory(id: string) {
  return useQuery({
    queryKey: queryKeys.history(id),
    queryFn: () => api.reviewHistory(id),
    refetchInterval: (query) =>
      query.state.data?.some((review) => review.status === "in_progress") ? FAST_POLL_MS : SLOW_POLL_MS,
  });
}

/**
 * Refetch the document, the list and the plan together, so the review panel and the quota
 * circle never tell different stories.
 */
export function useRefreshReviewState() {
  const queryClient = useQueryClient();
  return (documentId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.document(documentId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
      queryClient.invalidateQueries({ queryKey: queryKeys.plan }),
    ]);
}
