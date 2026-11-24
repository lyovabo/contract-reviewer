import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewState } from "@/components/StatusChip";
import type { ReviewSummary } from "@/lib/types";

// As the API sends it: the deadline is 60 s after the request (reviewDeadlineMs in api/config.json).
const review = (id: string, overrides: Partial<ReviewSummary>): ReviewSummary => {
  const requestedAt = overrides.requestedAt ?? "2026-09-24T10:00:00.000Z";
  return {
    id,
    documentId: "doc",
    requestedBy: "elena",
    requestedAt,
    deadlineAt: new Date(Date.parse(requestedAt) + 60_000).toISOString(),
    status: "completed",
    finishedAt: "2026-09-24T10:00:20.000Z",
    failureReason: null,
    reviewer: "fake",
    findingsCount: 3,
    ...overrides,
  };
};

// One document reviewed three times: completed (24 Sep), failed (12 Nov), completed (12 Nov).
const first = review("first", {});
const failed = review("second", {
  requestedBy: "kofi",
  requestedAt: "2026-11-12T09:00:00.000Z",
  status: "failed",
  finishedAt: "2026-11-12T09:00:08.000Z",
  failureReason: "engine_error",
  findingsCount: 1,
});
const third = review("third", { requestedAt: "2026-11-12T10:00:00.000Z", finishedAt: "2026-11-12T10:00:15.000Z", findingsCount: 2 });
const now = Date.parse("2026-11-12T12:00:00.000Z");
const lawyerName = (id: string) => ({ elena: "Elena Marsh", kofi: "Kofi Mensah" })[id] ?? "a colleague";

function renderState(latest: ReviewSummary | null, lastCompleted: ReviewSummary | null) {
  return render(<ReviewState latest={latest} lastCompleted={lastCompleted} now={now} lawyerName={lawyerName} />);
}

const openDetails = (name: RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("tooltip");
};

describe("documents list: review state", () => {
  it("a failed attempt with no earlier result: a short chip, and the why and what next in the tooltip", () => {
    renderState(failed, null);
    expect(screen.getByText("Review failed · no result yet")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(); // details stay out of the row

    const tooltip = openDetails(/why the review failed/i);
    expect(tooltip).toHaveTextContent("The AI stopped with an error before finishing.");
    expect(tooltip).toHaveTextContent("Requested by Kofi Mensah");
    expect(tooltip).toHaveTextContent("No credit was used.");
    expect(tooltip).toHaveTextContent("Next step: Retry from the document page.");

    fireEvent.keyDown(screen.getByRole("button", { name: /why the review failed/i }), { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("a failed re-review keeps the earlier result first, with a short failure chip", () => {
    renderState(failed, first);
    expect(screen.getByText("Reviewed 24 Sept · 3 findings")).toBeInTheDocument();
    expect(screen.getByText("Newer review failed")).toBeInTheDocument();
    expect(screen.queryByText(/no result yet/)).not.toBeInTheDocument();

    const tooltip = openDetails(/why the review failed/i);
    expect(tooltip).toHaveTextContent("The review from 24 Sept (3 findings) is still the document's current result.");
  });

  it("once a later review completes, it is the only thing shown: the earlier failure is history", () => {
    renderState(third, third);
    expect(screen.getByText("Reviewed 12 Nov · 2 findings")).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a review in progress shows its elapsed time; the current result it may replace is in the tooltip", () => {
    const running = review("running", { status: "in_progress", requestedAt: "2026-11-12T11:59:48.000Z", finishedAt: null });
    renderState(running, first);
    expect(screen.getByText("Review in progress · 12s")).toBeInTheDocument();

    const tooltip = openDetails(/review in progress: details/i);
    expect(tooltip).toHaveTextContent("It uses one credit only if it completes.");
    expect(tooltip).toHaveTextContent("The review from 24 Sept (3 findings) is still the document's current result.");
  });

  it("the time limit is the review's own (deadlineAt − requestedAt), not a number in the app", () => {
    const twentySeconds = { requestedAt: "2026-11-12T11:59:30.000Z", deadlineAt: "2026-11-12T11:59:50.000Z" };
    const running = review("running", { ...twentySeconds, status: "in_progress", finishedAt: null });
    const { unmount } = renderState(running, null);
    expect(screen.getByText("Review in progress · 20s")).toBeInTheDocument(); // 30 s elapsed, shown up to the limit
    expect(openDetails(/review in progress: details/i)).toHaveTextContent("within 20 seconds");
    unmount();

    const timedOut = review("timed-out", { ...twentySeconds, status: "failed", failureReason: "timeout" });
    renderState(timedOut, null);
    expect(openDetails(/why the review failed/i)).toHaveTextContent("The review took longer than 20 seconds");
  });
});
