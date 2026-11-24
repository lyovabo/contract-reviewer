"use client";

import { useSyncExternalStore } from "react";
import type { ReviewerKind } from "./types";

// No authentication: who is using the app is picked in the UI. Picking a lawyer claims that
// lawyer's session on the server (one live session per lawyer); the session token and the
// workspace choice are remembered per browser, so every tab of this browser shares them.
const LAWYER_KEY = "contract-reviewer.currentLawyerId";
const TOKEN_KEY = "contract-reviewer.sessionToken";
const WORKSPACE_KEY = "contract-reviewer.currentWorkspaceId";
// The AI chosen for new reviews, remembered per browser like the rest.
const REVIEWER_KEY = "contract-reviewer.reviewer";
const listeners = new Set<() => void>();
let notice: string | null = null; // why the session was lost, shown on the lawyer picker

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode): the choice lasts until reload.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const notify = () => listeners.forEach((listener) => listener());

/** After a successful claim. Also forgets the previous lawyer's workspace choice. */
export function setCurrentSession(lawyerId: string, token: string) {
  write(LAWYER_KEY, lawyerId);
  write(TOKEN_KEY, token);
  write(WORKSPACE_KEY, null);
  notice = null;
  notify();
}

/** Back to the lawyer picker, optionally saying why. */
export function clearCurrentSession(reason: string | null = null) {
  write(LAWYER_KEY, null);
  write(TOKEN_KEY, null);
  write(WORKSPACE_KEY, null);
  notice = reason;
  notify();
}

export function setCurrentWorkspaceId(id: string | null) {
  write(WORKSPACE_KEY, id);
  notify();
}

export const readSessionToken = () => read(TOKEN_KEY);

/** The current lawyer, only while this browser holds a session for them. */
export function useCurrentLawyerId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (read(TOKEN_KEY) ? read(LAWYER_KEY) : null),
    () => null,
  );
}

export function useSessionToken(): string | null {
  return useSyncExternalStore(subscribe, () => read(TOKEN_KEY), () => null);
}

export function useCurrentWorkspaceId(): string | null {
  return useSyncExternalStore(subscribe, () => read(WORKSPACE_KEY), () => null);
}

/** The AI last chosen in this browser: "claude" only if Claude was picked, else the simulated one. */
export function useReviewerChoice(): ReviewerKind {
  return useSyncExternalStore(
    subscribe,
    () => (read(REVIEWER_KEY) === "claude" ? "claude" : "fake"),
    () => "fake",
  );
}

export function setReviewerChoice(reviewer: ReviewerKind) {
  write(REVIEWER_KEY, reviewer);
  notify();
}

export function useSessionNotice(): string | null {
  return useSyncExternalStore(subscribe, () => notice, () => null);
}
