import { toIso } from './time';

/** Half-open [startMs, endMs) window of the UTC calendar month containing `nowMs`. */
export interface MonthWindow {
  startMs: number;
  endMs: number;
}

export function utcMonthWindow(nowMs: number): MonthWindow {
  const d = new Date(nowMs);
  return {
    startMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
    endMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
  };
}

/**
 * The plan as seen at one instant. A review is charged to the month it was REQUESTED in.
 * - limit: reviews included per calendar month (UTC) for the whole workspace (config.json)
 * - used: completed reviews (spent credits)
 * - reserved: in-progress, not-yet-expired reviews (credits held, not spent; released if they fail)
 */
export interface PlanUsage {
  workspaceId: string;
  month: string;
  limit: number;
  used: number;
  reserved: number;
  available: number;
  resetsAt: string;
}

export function planUsage(
  workspaceId: string,
  window: MonthWindow,
  used: number,
  reserved: number,
  limit: number,
): PlanUsage {
  return {
    workspaceId,
    month: toIso(window.startMs).slice(0, 7),
    limit,
    used,
    reserved,
    available: Math.max(0, limit - used - reserved),
    resetsAt: toIso(window.endMs),
  };
}

/**
 * Why a new review cannot be admitted, if it cannot. The two causes are never conflated:
 * - plan_exhausted: every credit is spent; nothing frees up before resetsAt
 * - slots_reserved: the remaining credits are held by running reviews and come back if they fail
 */
export type QuotaRefusal = 'plan_exhausted' | 'slots_reserved';

export function quotaRefusal(usage: PlanUsage): QuotaRefusal | null {
  if (usage.used >= usage.limit) return 'plan_exhausted';
  if (usage.used + usage.reserved >= usage.limit) return 'slots_reserved';
  return null;
}
