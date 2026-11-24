import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentReview } from "@/components/DocumentReview";
import { Header } from "@/components/Header";
import type { DocumentDetail, Review, ReviewerKind } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const DOC_ID = "doc-nda";
const ELENA = "elena";
const WORKSPACE = { id: "ws-firm", name: "Firm workspace" };
const REVIEWER_KEY = "contract-reviewer.reviewer";

const completed: Review = {
  id: "review-1",
  documentId: DOC_ID,
  requestedBy: ELENA,
  requestedAt: "2026-11-12T09:00:00.000Z",
  deadlineAt: "2026-11-12T09:01:00.000Z",
  status: "completed",
  finishedAt: "2026-11-12T09:00:18.000Z",
  failureReason: null,
  reviewer: "claude",
  findings: [],
};

const detail: DocumentDetail = {
  id: DOC_ID,
  workspace: WORKSPACE,
  title: "Non-disclosure agreement",
  type: "nda",
  pages: 5,
  uploadedAt: "2026-09-02T09:14:00Z",
  uploadedBy: ELENA,
  supersedes: null,
  supersededBy: null,
  latestReview: completed,
  previousCompletedReview: null,
};

// What the fake API offers, and the review requests it received.
let offered: ReviewerKind[];
let requests: unknown[];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("contract-reviewer.currentLawyerId", ELENA);
  window.localStorage.setItem("contract-reviewer.sessionToken", "tok-elena");
  offered = ["fake"];
  requests = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/settings")) {
        return json(200, { reviewDeadlineMs: 60_000, monthlyReviewLimit: 10, sessionTtlMs: 30_000, reviewers: offered });
      }
      if (url.endsWith("/plan")) {
        return json(200, { workspaceId: WORKSPACE.id, month: "2026-11", limit: 10, used: 1, reserved: 0, available: 9, resetsAt: "2026-12-01T00:00:00.000Z" });
      }
      if (url.endsWith("/lawyers")) {
        return json(200, [{ id: ELENA, name: "Elena Marsh", title: "Partner", workspaces: [WORKSPACE], inUse: true }]);
      }
      if (url.endsWith("/reviews") && init.method === "POST") {
        requests.push(JSON.parse(String(init.body)));
        return json(201, { ...completed, id: "review-2", status: "in_progress", finishedAt: null });
      }
      return json(200, detail);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

/** The document page under the app's header, as in the layout. */
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Header />
      <DocumentReview documentId={DOC_ID} />
    </QueryClientProvider>,
  );
}

const ai = () => screen.getByRole("group", { name: "AI for this review" });
const headerAi = () => screen.getByRole("group", { name: "AI for new reviews" });

describe("choosing the AI for a review: Simulated AI or Claude", () => {
  it("without Claude on the server, the simulated AI is used and Claude is greyed out with the reason", async () => {
    renderPage();
    const run = await screen.findByRole("button", { name: "Run a new review" });

    await vi.waitFor(() => expect(within(ai()).getByRole("radio", { name: "Claude" })).toBeDisabled());
    expect(within(ai()).getByRole("radio", { name: "Simulated AI" })).toBeChecked();
    expect(ai()).toHaveTextContent("Claude needs an Anthropic API key on the server (ANTHROPIC_API_KEY).");

    fireEvent.click(run);
    await vi.waitFor(() => expect(requests).toEqual([{ reviewer: "fake" }]));
  });

  it("with Claude offered, choosing it shows the cost, sends it with the request, and is remembered", async () => {
    offered = ["fake", "claude"];
    renderPage();
    const run = await screen.findByRole("button", { name: "Run a new review" });
    const claude = await vi.waitFor(() => {
      const radio = within(ai()).getByRole("radio", { name: "Claude" });
      expect(radio).toBeEnabled();
      return radio;
    });

    fireEvent.click(claude);
    expect(claude).toBeChecked();
    expect(ai()).toHaveTextContent("Claude reads the contract: a real API call, paid per review.");
    expect(ai()).toHaveTextContent("The same 60-second limit and plan apply.");
    expect(window.localStorage.getItem(REVIEWER_KEY)).toBe("claude");

    fireEvent.click(run);
    await vi.waitFor(() => expect(requests).toEqual([{ reviewer: "claude" }]));
  });

  it("a remembered Claude choice falls back to the simulated AI when the server no longer offers Claude", async () => {
    window.localStorage.setItem(REVIEWER_KEY, "claude");
    renderPage();
    const run = await screen.findByRole("button", { name: "Run a new review" });

    expect(within(ai()).getByRole("radio", { name: "Simulated AI" })).toBeChecked();
    fireEvent.click(run);
    await vi.waitFor(() => expect(requests).toEqual([{ reviewer: "fake" }]));
  });

  it("the header has the same switch, on every page: a choice made there is what the request uses", async () => {
    offered = ["fake", "claude"];
    renderPage();
    const run = await screen.findByRole("button", { name: "Run a new review" });
    const inHeader = await vi.waitFor(() => {
      const radio = within(headerAi()).getByRole("radio", { name: "Claude" });
      expect(radio).toBeEnabled();
      return radio;
    });

    fireEvent.click(inHeader);
    expect(inHeader).toBeChecked();
    expect(within(ai()).getByRole("radio", { name: "Claude" })).toBeChecked(); // the request box follows
    fireEvent.click(run);
    await vi.waitFor(() => expect(requests).toEqual([{ reviewer: "claude" }]));

    fireEvent.click(within(ai()).getByRole("radio", { name: "Simulated AI" })); // and the other way round
    expect(within(headerAi()).getByRole("radio", { name: "Simulated AI" })).toBeChecked();
  });

  it("without Claude on the server, the header's Claude option is greyed out too, and says why", async () => {
    renderPage();
    const inHeader = await vi.waitFor(() => within(headerAi()).getByRole("radio", { name: "Claude" }));
    await vi.waitFor(() => expect(inHeader).toBeDisabled());
    expect(inHeader.closest("label")).toHaveAttribute(
      "title",
      "Claude needs an Anthropic API key on the server (ANTHROPIC_API_KEY).",
    );
    expect(within(headerAi()).getByRole("radio", { name: "Simulated AI" })).toBeChecked();
  });

  it("each review says which AI ran it", async () => {
    renderPage();
    const latest = await screen.findByRole("region", { name: "Latest review" });
    expect(latest).toHaveTextContent("requested by Elena Marsh · Claude");
  });
});
