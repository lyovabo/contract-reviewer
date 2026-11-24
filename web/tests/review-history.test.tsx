import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentReview } from "@/components/DocumentReview";
import { ReviewHistory } from "@/components/ReviewHistory";
import type { DocumentDetail, Finding, HistoryFinding, ReviewHistoryEntry } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const DOC_ID = "doc-nda";
const WORKSPACE = { id: "ws-firm", name: "Firm workspace" };

const finding = (position: number, title: string): Finding => ({
  position,
  clause: `${position + 1}.1`,
  title,
  severity: "high",
  excerpt: `Quote ${position}.`,
  explanation: "Why it matters.",
  receivedAt: "2026-11-12T09:00:05.000Z",
});
const tagged = (f: Finding, change: HistoryFinding["change"]): HistoryFinding => ({ ...f, change });
const A = finding(0, "Confidentiality lasts one year");
const B = finding(1, "Residuals clause");
const C = finding(2, "No governing law");

const entry = (id: string, minute: number, extra: Partial<ReviewHistoryEntry>): ReviewHistoryEntry => ({
  id,
  documentId: DOC_ID,
  requestedBy: "elena",
  requestedAt: `2026-11-12T09:0${minute}:00.000Z`,
  deadlineAt: `2026-11-12T09:0${minute + 1}:00.000Z`,
  status: "completed",
  finishedAt: `2026-11-12T09:0${minute}:20.000Z`,
  failureReason: null,
  reviewer: "fake",
  findings: [],
  comparedWith: null,
  noLongerFlagged: [],
  ...extra,
});

// Newest first, as the API sends it: running, completed (compared with the first), failed, first completed.
const history: ReviewHistoryEntry[] = [
  entry("r4", 6, { status: "in_progress", finishedAt: null, reviewer: "claude", findings: [tagged(A, null)] }),
  entry("r3", 4, {
    findings: [tagged(A, "unchanged"), tagged(C, "new")],
    comparedWith: { id: "r1", requestedAt: "2026-11-12T09:00:00.000Z" },
    noLongerFlagged: [B],
  }),
  entry("r2", 2, { status: "failed", failureReason: "engine_error", findings: [tagged(C, null)] }),
  entry("r1", 0, { findings: [tagged(A, null), tagged(B, null)] }),
];

const detail: DocumentDetail = {
  id: DOC_ID,
  workspace: WORKSPACE,
  title: "Non-disclosure agreement",
  type: "nda",
  pages: 5,
  uploadedAt: "2026-09-02T09:14:00Z",
  uploadedBy: "elena",
  supersedes: null,
  supersededBy: null,
  latestReview: { ...history[1]!, findings: [A, C] },
  previousCompletedReview: null,
};

// What the fake API answers for the document; a test can change it.
let current: DocumentDetail;

beforeEach(() => {
  current = detail;
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith(`/documents/${DOC_ID}/reviews`)) return json(history);
      if (url.endsWith("/lawyers")) return json([{ id: "elena", name: "Elena Marsh", title: "Partner", workspaces: [WORKSPACE] }]);
      if (url.endsWith("/settings")) return json({ reviewDeadlineMs: 60_000, monthlyReviewLimit: 10, sessionTtlMs: 30_000, reviewers: ["fake"] });
      if (url.endsWith("/plan")) return json({ workspaceId: WORKSPACE.id, month: "2026-11", limit: 10, used: 2, reserved: 0, available: 8, resetsAt: "2026-12-01T00:00:00.000Z" });
      return json(current);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const reviewItems = () => screen.getAllByRole("listitem", { name: /^Review of / });

describe("review history page", () => {
  it("lists every review newest first, with its result, who asked, which AI, and the current result", async () => {
    renderWith(<ReviewHistory documentId={DOC_ID} />);
    expect(await screen.findByRole("heading", { name: "Review history" })).toBeInTheDocument();

    const [running, second, failed, first] = reviewItems();
    expect(running).toHaveTextContent("In progress");
    expect(running).toHaveTextContent("Claude");
    expect(running).toHaveTextContent("1 finding so far");
    expect(running).toHaveTextContent("Still running: these are partial results");
    expect(second).toHaveTextContent("Current result"); // the newest completed review
    expect(failed).toHaveTextContent("Failed");
    expect(failed).toHaveTextContent("1 finding before it failed");
    expect(first).toHaveTextContent("Elena Marsh");
    expect(first).toHaveTextContent("Simulated AI");
    expect(screen.getAllByText("Current result")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Back to the document/ })).toHaveAttribute("href", `/documents/${DOC_ID}`);
  });

  it("compares a completed review with the previous completed one: new, also found before, no longer flagged", async () => {
    renderWith(<ReviewHistory documentId={DOC_ID} />);
    await screen.findByRole("heading", { name: "Review history" });
    const second = reviewItems()[1]!;

    expect(second).toHaveTextContent(/Compared with the review of .*: 1 new, 1 also found before, 1 no longer flagged\./);
    const found = within(second).getAllByRole("listitem");
    expect(found[0]).toHaveTextContent(A.title);
    expect(found[0]).toHaveTextContent("Also found before");
    expect(found[1]).toHaveTextContent(C.title);
    expect(found[1]).toHaveTextContent("New");
    const dropped = within(second).getByRole("region", { name: "No longer flagged" });
    expect(dropped).toHaveTextContent("No longer flagged (1)");
    expect(dropped).toHaveTextContent(B.title);
  });

  it("a failed review's findings are labeled incomplete and are not compared; the first completed one has nothing to compare with", async () => {
    renderWith(<ReviewHistory documentId={DOC_ID} />);
    await screen.findByRole("heading", { name: "Review history" });
    const [, , failed, first] = reviewItems();

    expect(failed).toHaveTextContent("The AI review stopped with an error. No credit was used.");
    expect(failed).toHaveTextContent("incomplete, and not compared with other reviews");
    expect(within(failed).getByText("Incomplete review")).toBeInTheDocument();
    expect(within(failed).queryByText("New")).not.toBeInTheDocument();
    expect(failed).not.toHaveTextContent("No issues found");

    expect(first).toHaveTextContent("The first completed review of this document: nothing to compare with.");
    expect(within(first).queryByText("New")).not.toBeInTheDocument();
    expect(within(first).queryByText("Also found before")).not.toBeInTheDocument();
  });

  it("the document page has a Review history button, which opens the history once the document has a review", async () => {
    renderWith(<DocumentReview documentId={DOC_ID} />);
    expect(await screen.findByRole("link", { name: "Review history" })).toHaveAttribute(
      "href",
      `/documents/${DOC_ID}/history`,
    );
  });

  it("before any review, the Review history button is greyed out and says why", async () => {
    current = { ...detail, latestReview: null };
    renderWith(<DocumentReview documentId={DOC_ID} />);
    const button = await screen.findByRole("button", { name: "Review history" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "No reviews yet: the history starts with the first review.");
    expect(screen.queryByRole("link", { name: "Review history" })).not.toBeInTheDocument();
  });
});
