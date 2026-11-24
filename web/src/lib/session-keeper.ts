"use client";

import { useEffect } from "react";
import { ApiError, api } from "./api";
import { clearCurrentSession, readSessionToken, setCurrentSession } from "./current-lawyer";
import type { Lawyer } from "./types";

/** A tab nobody has touched for this long stops holding the lawyer, so a forgotten tab locks nobody out. */
export const IDLE_MS = 15 * 60_000;

/**
 * Keeps this browser's session for `lawyer` alive while the tab is visible and in use. If the
 * session has ended (idle, asleep, offline), it tries to take the lawyer back; if someone else is
 * using them by then, it returns to the lawyer picker and says why.
 *
 * It sends a heartbeat every third of the server's session lifetime (`sessionTtlMs`, from
 * GET /api/settings), so a session survives two missed heartbeats. Nothing is sent until the
 * settings have loaded.
 */
export function useKeepSessionAlive(lawyer: Lawyer | null, sessionTtlMs: number | null) {
  const lawyerId = lawyer?.id ?? null;
  const lawyerName = lawyer?.name ?? "";
  const heartbeatMs = sessionTtlMs === null ? null : Math.round(sessionTtlMs / 3);

  useEffect(() => {
    if (!lawyerId || heartbeatMs === null) return;
    let lastActivity = Date.now();
    let busy = false;

    const keepAlive = async () => {
      if (busy || document.visibilityState !== "visible" || Date.now() - lastActivity > IDLE_MS) return;
      busy = true;
      try {
        const token = readSessionToken();
        if (token) {
          try {
            await api.heartbeat(token);
            return;
          } catch (err) {
            if (!(err instanceof ApiError && err.status === 401)) return; // offline: try again later
          }
        }
        try {
          const session = await api.claimSession(lawyerId);
          setCurrentSession(lawyerId, session.token);
        } catch (err) {
          if (err instanceof ApiError && err.code === "lawyer_in_use") {
            clearCurrentSession(`${lawyerName} is now being used in another browser.`);
          }
        }
      } finally {
        busy = false;
      }
    };

    const onActivity = () => {
      const wasIdle = Date.now() - lastActivity > IDLE_MS;
      lastActivity = Date.now();
      if (wasIdle) void keepAlive();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void keepAlive();
    };

    void keepAlive();
    const timer = setInterval(keepAlive, heartbeatMs);
    const activityEvents = ["pointerdown", "pointermove", "keydown", "scroll"] as const;
    activityEvents.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      activityEvents.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [lawyerId, lawyerName, heartbeatMs]);
}

/** Leave: forget the lawyer here and free them for others at once (best effort). */
export function releaseCurrentSession() {
  const token = readSessionToken();
  clearCurrentSession();
  if (token) api.releaseSession(token).catch(() => {});
}
