import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import UpgradePage from "@/app/upgrade/page";
import { LatestReviewPanel } from "@/components/ReviewPanels";
import type { Review } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

// A review with a 20-second limit, as the API sends it when reviewDeadlineMs is 20000.
const requestedAt = "2026-11-12T09:00:00.000Z";
const review = (overrides: Partial<Review>): Review => ({
  id: "r1",
  documentId: "doc",
  requestedBy: "elena",
  requestedAt,
  deadlineAt: "2026-11-12T09:00:20.000Z",
  status: "in_progress",
  finishedAt: null,
  failureReason: null,
  reviewer: "fake",
  findings: [],
  ...overrides,
});
const lawyerName = () => "Elena Marsh";

describe("the app's numbers come from the API, not from the app", () => {
  it("the document page's live panel counts up to the review's own limit", () => {
    render(<LatestReviewPanel review={review({})} lawyerName={lawyerName} now={Date.parse(requestedAt) + 12_000} />);
    expect(screen.getByText("12s elapsed · stops at 20s")).toBeInTheDocument();
  });

  it("the document page says a timed-out review hit the review's own limit", () => {
    const timedOut = review({ status: "failed", failureReason: "timeout", finishedAt: "2026-11-12T09:00:20.000Z" });
    render(<LatestReviewPanel review={timedOut} lawyerName={lawyerName} now={Date.parse(requestedAt) + 30_000} />);
    expect(screen.getByText(/The review did not finish within 20 seconds, so it was stopped\./)).toBeInTheDocument();
  });

  it("the upgrade page states the plan's monthly limit, and sizes its demo offers from it", async () => {
    const settings = { reviewDeadlineMs: 60_000, monthlyReviewLimit: 25, sessionTtlMs: 30_000, reviewers: ["fake"] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(settings), { headers: { "Content-Type": "application/json" } })),
    );
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <UpgradePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Your plan includes 25 AI reviews per calendar month/)).toBeInTheDocument();
    expect(screen.getByText("25 more reviews this month")).toBeInTheDocument();
    expect(screen.getByText("75 reviews every month")).toBeInTheDocument();
  });
});
