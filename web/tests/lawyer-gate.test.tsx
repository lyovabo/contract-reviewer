import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/Header";
import { LawyerGate } from "@/components/LawyerGate";
import { clearCurrentSession } from "@/lib/current-lawyer";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const LAWYER_KEY = "contract-reviewer.currentLawyerId";
const TOKEN_KEY = "contract-reviewer.sessionToken";
const WORKSPACE_KEY = "contract-reviewer.currentWorkspaceId";
const FIRM = { id: "ws-firm", name: "Firm workspace" };
const OTHER = { id: "ws-other", name: "Other workspace" };
const ELENA = { id: "elena", name: "Elena Marsh", title: "Partner", workspaces: [FIRM], inUse: false };
const PRIYA = { id: "priya", name: "Priya Raman", title: "Senior associate", workspaces: [FIRM], inUse: false };
const KOFI = { id: "kofi", name: "Kofi Mensah", title: "Trainee lawyer", workspaces: [FIRM], inUse: false };
const PLAN = { month: "2026-11", limit: 10, used: 0, reserved: 0, available: 10, resetsAt: "2026-12-01T00:00:00.000Z" };

// What the fake API answers; each test adjusts it.
let server: {
  lawyers: (typeof ELENA)[];
  claimStatus: number;
  heartbeatStatus: number;
  sessionTtlMs: number;
  /** How many settings requests fail before one succeeds. */
  settingsFailures: number;
  calls: { method: string; url: string; token?: string }[];
};

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  clearCurrentSession(); // also resets the in-memory "why you were signed out" notice
  window.localStorage.clear();
  push.mockClear();
  server = {
    lawyers: [ELENA, PRIYA, KOFI],
    claimStatus: 201,
    heartbeatStatus: 200,
    sessionTtlMs: 30_000,
    settingsFailures: 0,
    calls: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const token = (init.headers as Record<string, string>)?.Authorization?.replace("Bearer ", "");
      server.calls.push({ method, url, token });
      if (url.endsWith("/settings")) {
        if (server.settingsFailures > 0) {
          server.settingsFailures--;
          return json(500, { error: { code: "internal_error", message: "Internal error" } });
        }
        return json(200, {
          reviewDeadlineMs: 60_000,
          monthlyReviewLimit: 10,
          sessionTtlMs: server.sessionTtlMs,
          reviewers: ["fake"],
        });
      }
      if (url.endsWith("/lawyers")) return json(200, server.lawyers);
      if (url.endsWith("/sessions") && method === "POST") {
        const { lawyerId } = JSON.parse(String(init.body));
        return server.claimStatus === 201
          ? json(201, { token: `tok-${lawyerId}`, lawyerId, ttlMs: 30_000 })
          : json(409, { error: { code: "lawyer_in_use", message: "in use" } });
      }
      if (url.endsWith("/sessions/current") && method === "PUT") {
        return server.heartbeatStatus === 200
          ? json(200, { lawyerId: "x" })
          : json(401, { error: { code: "session_expired", message: "ended" } });
      }
      if (url.endsWith("/sessions/current") && method === "DELETE") return json(204, null);
      return json(200, { ...PLAN, workspaceId: url.split("/")[3] });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function signedInAs(lawyerId: string) {
  window.localStorage.setItem(LAWYER_KEY, lawyerId);
  window.localStorage.setItem(TOKEN_KEY, `tok-${lawyerId}`);
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Header />
      <LawyerGate>
        <p>Workspace documents</p>
      </LawyerGate>
    </QueryClientProvider>,
  );
}

describe("choosing who you are is the first step", () => {
  it("shows no documents until a lawyer is chosen, then claims their session and opens their workspace", async () => {
    renderApp();

    expect(await screen.findByRole("heading", { name: "Who is using Contract Reviewer?" })).toBeInTheDocument();
    expect(screen.queryByText("Workspace documents")).not.toBeInTheDocument();
    expect(screen.queryByText(/Working as/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Elena Marsh/ }));

    // One workspace: no extra step, and its name is shown.
    expect(await screen.findByText("Workspace documents")).toBeInTheDocument();
    expect(screen.getByText("Elena Marsh", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Firm workspace", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch workspace" })).not.toBeInTheDocument();
    expect(server.calls).toContainEqual(expect.objectContaining({ method: "POST", url: "/api/sessions" }));
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("tok-elena");
  });

  it("switching lawyer releases the session and goes to the choice and the documents list", async () => {
    signedInAs(KOFI.id);
    renderApp();
    expect(await screen.findByText("Workspace documents")).toBeInTheDocument();

    act(() => fireEvent.click(screen.getByRole("button", { name: "Switch lawyer" })));

    expect(screen.getByRole("heading", { name: "Who is using Contract Reviewer?" })).toBeInTheDocument();
    expect(screen.queryByText("Workspace documents")).not.toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/");
    expect(server.calls).toContainEqual({ method: "DELETE", url: "/api/sessions/current", token: "tok-kofi" });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("treats a remembered id that is not a known lawyer as no choice", async () => {
    signedInAs("someone-who-left");
    renderApp();
    expect(await screen.findByRole("heading", { name: "Who is using Contract Reviewer?" })).toBeInTheDocument();
    expect(screen.queryByText("Workspace documents")).not.toBeInTheDocument();
  });

  it("a lawyer in several workspaces picks one before seeing any documents, and can switch", async () => {
    server.lawyers = [{ ...ELENA, workspaces: [FIRM, OTHER] }, PRIYA, KOFI];
    signedInAs(ELENA.id);
    renderApp();

    expect(await screen.findByRole("heading", { name: "Which workspace?" })).toBeInTheDocument();
    expect(screen.queryByText("Workspace documents")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Other workspace" }));
    expect(screen.getByText("Workspace documents")).toBeInTheDocument();
    expect(screen.getByText("Other workspace", { selector: "strong" })).toBeInTheDocument();
    expect(window.localStorage.getItem(WORKSPACE_KEY)).toBe(OTHER.id);

    act(() => fireEvent.click(screen.getByRole("button", { name: "Switch workspace" })));
    expect(screen.getByRole("heading", { name: "Which workspace?" })).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/");
    expect(window.localStorage.getItem(LAWYER_KEY)).toBe(ELENA.id); // still the same lawyer
  });
});

describe("one browser at a time per lawyer", () => {
  it("a lawyer being used in another browser is shown as in use and cannot be picked", async () => {
    server.lawyers = [ELENA, { ...PRIYA, inUse: true }, KOFI];
    renderApp();

    const priya = await screen.findByRole("button", { name: /Priya Raman/ });
    expect(priya).toBeDisabled();
    expect(priya).toHaveTextContent("In use");
    expect(priya).toHaveAccessibleDescription(/another browser/);
    expect(screen.getByRole("button", { name: /Elena Marsh/ })).toBeEnabled();
  });

  it("says when an in-use lawyer frees up, from the API's session lifetime", async () => {
    server.sessionTtlMs = 45_000;
    server.lawyers = [ELENA, { ...PRIYA, inUse: true }, KOFI];
    renderApp();

    const priya = await screen.findByRole("button", { name: /Priya Raman/ });
    await vi.waitFor(() => expect(priya).toHaveAccessibleDescription(/It frees up 45 seconds after they leave/));
  });

  it("losing a race for the same lawyer keeps you on the choice and says so", async () => {
    server.claimStatus = 409;
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: /Elena Marsh/ }));

    expect(await screen.findByText(/Someone started working as that lawyer a moment ago/)).toBeInTheDocument();
    expect(screen.queryByText("Workspace documents")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("if this browser's session ended and someone else took the lawyer, it goes back to the choice and says why", async () => {
    signedInAs(ELENA.id);
    server.heartbeatStatus = 401; // e.g. the laptop slept for a while
    server.claimStatus = 409; // ...and a colleague is now working as Elena
    renderApp();

    expect(await screen.findByText("Elena Marsh is now being used in another browser.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Who is using Contract Reviewer?" })).toBeInTheDocument();
    expect(screen.queryByText("Workspace documents")).not.toBeInTheDocument();
  });

  it("if this browser's session ended but nobody took the lawyer, it quietly takes it back", async () => {
    signedInAs(ELENA.id);
    server.heartbeatStatus = 401;
    renderApp();

    expect(await screen.findByText("Workspace documents")).toBeInTheDocument();
    await vi.waitFor(() => expect(server.calls.some((c) => c.method === "POST")).toBe(true));
    expect(screen.getByText("Workspace documents")).toBeInTheDocument();
  });
});

describe("keeping the session alive", () => {
  const heartbeats = () => server.calls.filter((c) => c.method === "PUT" && c.url === "/api/sessions/current");

  it("sends a heartbeat every third of the API's session lifetime", async () => {
    server.sessionTtlMs = 3_000; // so one heartbeat a second
    signedInAs(ELENA.id);
    renderApp();

    await vi.waitFor(() => expect(heartbeats().length).toBeGreaterThanOrEqual(3), { timeout: 3_500 });
  }, 10_000);

  it("keeps asking for the settings until the API answers, then starts the heartbeat", async () => {
    server.settingsFailures = 2; // e.g. the API is restarting
    signedInAs(ELENA.id);
    renderApp();

    expect(await screen.findByText("Workspace documents")).toBeInTheDocument();
    expect(heartbeats()).toHaveLength(0); // nothing is sent without the session lifetime
    await vi.waitFor(() => expect(heartbeats().length).toBeGreaterThanOrEqual(1), { timeout: 4_000 });
    expect(server.calls.filter((c) => c.url === "/api/settings").length).toBeGreaterThanOrEqual(3);
  }, 10_000);
});
