import type {
  DocumentDetail,
  DocumentSummary,
  Lawyer,
  Plan,
  Review,
  ReviewHistoryEntry,
  ReviewerKind,
  Session,
  Settings,
  Workspace,
} from "./types";

/** An error answer from the API: `{ error: { code, message, ...details } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { token?: string | null }): Promise<T> {
  const { token, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const error = body?.error ?? {};
    throw new ApiError(res.status, error.code ?? "http_error", error.message ?? res.statusText, error);
  }
  return body as T;
}

const workspacePath = (id: string) => `/workspaces/${encodeURIComponent(id)}`;

export const api = {
  settings: () => request<Settings>("/settings"),
  lawyers: () => request<Lawyer[]>("/lawyers"),
  workspace: (id: string) => request<Workspace>(workspacePath(id)),
  plan: (workspaceId: string) => request<Plan>(`${workspacePath(workspaceId)}/plan`),
  documents: (workspaceId: string) => request<DocumentSummary[]>(`${workspacePath(workspaceId)}/documents`),
  document: (id: string) => request<DocumentDetail>(`/documents/${encodeURIComponent(id)}`),
  /** Every review of the document, newest first, each compared with the previous completed one. */
  reviewHistory: (id: string) => request<ReviewHistoryEntry[]>(`/documents/${encodeURIComponent(id)}/reviews`),

  /** Take a lawyer's session. 409 `lawyer_in_use` if someone else is using that lawyer. */
  claimSession: (lawyerId: string) =>
    request<Session>("/sessions", { method: "POST", body: JSON.stringify({ lawyerId }) }),
  /** Keep the session alive. 401 `session_expired` once it has ended. */
  heartbeat: (token: string) => request<{ lawyerId: string }>("/sessions/current", { method: "PUT", token }),
  releaseSession: (token: string) => request<null>("/sessions/current", { method: "DELETE", token }),

  /** The requester is the session's lawyer, decided by the server. `reviewer` is the AI chosen for it. */
  requestReview: (documentId: string, token: string, reviewer: ReviewerKind) =>
    request<Review>(`/documents/${encodeURIComponent(documentId)}/reviews`, {
      method: "POST",
      token,
      body: JSON.stringify({ reviewer }),
    }),
};
