import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentReview } from "@/components/DocumentReview";
import type { DocumentDetail, Finding, Plan, Review } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const DOC_ID = "781cb31d-2941-4006-a12e-1269022a1c7c";
const ELENA = "9827c4e1-cac8-4824-9872-b7c7f48f4e5c";

const finding = (position: number, title: string, extra: Partial<Finding> = {}): Finding => ({
  position,
  clause: `${position + 1}.1`,
  title,
  severity: "high",
  excerpt: "Quoted clause text.",
  explanation: "Why it matters.",
  receivedAt: "2026-11-12T09:00:05.000Z",
  ...extra,
});

const previous: Review = {
  id: "review-previous",
  documentId: DOC_ID,
  requestedBy: ELENA,
  requestedAt: "2026-09-24T10:00:00.000Z",
  deadlineAt: "2026-09-24T10:01:00.000Z",
  status: "completed",
  finishedAt: "2026-09-24T10:00:20.000Z",
  failureReason: null,
  reviewer: "fake",
  findings: [finding(0, "Earlier final finding")],
};

const running: Review = {
  id: "review-new",
  documentId: DOC_ID,
  requestedBy: ELENA,
  requestedAt: new Date().toISOString(),
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  status: "in_progress",
  finishedAt: null,
  failureReason: null,
  reviewer: "fake",
  findings: [finding(0, "Streamed finding one"), finding(1, "Streamed finding two", { clause: null, excerpt: null })],
};

const WORKSPACE = { id: "ws-firm", name: "Firm workspace" };
const plan: Plan = { workspaceId: WORKSPACE.id, month: "2026-11", limit: 10, used: 3, reserved: 1, available: 6, resetsAt: "2026-12-01T00:00:00.000Z" };

let detail: DocumentDetail;

beforeEach(() => {
  detail = {
    id: DOC_ID,
    workspace: WORKSPACE,
    title: "Non-disclosure agreement — Halden Robotics AB",
    type: "nda",
    pages: 5,
    uploadedAt: "2026-09-02T09:14:00Z",
    uploadedBy: ELENA,
    supersedes: null,
    supersededBy: null,
    latestReview: running,
    previousCompletedReview: previous,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.endsWith("/plan")
        ? plan
        : url.endsWith("/settings")
          ? { reviewDeadlineMs: 60_000, monthlyReviewLimit: 10, sessionTtlMs: 30_000, reviewers: ["fake"] }
          : url.endsWith("/lawyers")
          ? [{ id: ELENA, name: "Elena Marsh", title: "Partner", workspaces: [WORKSPACE] }]
          : detail;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentReview documentId={DOC_ID} />
    </QueryClientProvider>,
  );
}

describe("previous result + partial findings (product decisions 1 and 2)", () => {
  it("keeps the previous completed review visible and labels a failed review's partial findings as incomplete", async () => {
    renderPage();

    // While the new review runs: its findings stream under a "partial results" banner…
    const live = await screen.findByRole("region", { name: "Latest review" });
    expect(within(live).getByText("Review in progress — partial results")).toBeInTheDocument();
    expect(within(live).getByText("Streamed finding one")).toBeInTheDocument();
    expect(within(live).getByText("General")).toBeInTheDocument(); // clause: null
    // …and the previous completed result stays on screen, badged as previous.
    const before = screen.getByRole("region", { name: "Previous review" });
    expect(within(before).getByText(/Previous review — completed 24 Sep/)).toBeInTheDocument();
    expect(within(before).getByText("Earlier final finding")).toBeInTheDocument();

    // The new review fails; the next poll picks it up.
    detail = {
      ...detail,
      latestReview: {
        ...running,
        status: "failed",
        failureReason: "engine_error",
        finishedAt: new Date().toISOString(),
      },
    };

    const failed = await screen.findByText("Review failed", {}, { timeout: 4_000 });
    const latest = screen.getByRole("region", { name: "Latest review" });
    expect(latest).toContainElement(failed);
    expect(within(latest).getByText(/From a failed review — incomplete/)).toBeInTheDocument();
    expect(within(latest).getByText("Streamed finding one")).toBeInTheDocument();
    expect(within(latest).getByText("Streamed finding two")).toBeInTheDocument();
    expect(within(latest).getAllByText("Incomplete review")).toHaveLength(2);
    expect(within(latest).queryByText("Review in progress — partial results")).not.toBeInTheDocument();
    expect(within(latest).queryByText("No issues found")).not.toBeInTheDocument();

    const after = screen.getByRole("region", { name: "Previous review" });
    expect(within(after).getByText(/Previous review — completed 24 Sep/)).toBeInTheDocument();
    expect(within(after).getByText("Earlier final finding")).toBeInTheDocument();
    expect(within(after).queryByText("Incomplete review")).not.toBeInTheDocument();
  });
});
