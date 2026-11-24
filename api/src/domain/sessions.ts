import { randomUUID } from 'node:crypto';
import type { Repository } from '../db/repository';
import type { Clock } from './time';

export type ClaimResult =
  | { ok: true; token: string; lawyerId: string }
  | { ok: false; error: 'unknown_lawyer' | 'lawyer_in_use' };

/**
 * One live session per lawyer: while a lawyer is being used in one browser, nobody else can act
 * as that lawyer. A session stays live while its browser sends heartbeats, and ends `ttlMs`
 * (sessionTtlMs in config.json) after the last one, so a closed or idle tab never locks anyone
 * out for long.
 *
 * This is NOT authentication (there are no credentials, per the brief): anyone can still claim a
 * lawyer who has no live session. It stops two people using the same lawyer at the same time.
 */
export class SessionService {
  constructor(
    private readonly repo: Repository,
    private readonly clock: Clock,
    /** A session with no heartbeat for this long has ended (closed tab, idle, lost connection). */
    readonly ttlMs: number,
    private readonly newToken: () => string = randomUUID,
  ) {}

  /** Race-safe: two browsers claiming the same lawyer at once get one session between them. */
  claim(lawyerId: string): ClaimResult {
    if (!this.repo.getLawyer(lawyerId)) return { ok: false, error: 'unknown_lawyer' };
    const nowMs = this.clock.now();
    return this.repo.immediateTransaction((): ClaimResult => {
      this.repo.deleteExpiredSession(lawyerId, nowMs, this.ttlMs);
      // Any session left is live: an expired one was just deleted.
      if (this.repo.sessionToken(lawyerId)) return { ok: false, error: 'lawyer_in_use' };
      const token = this.newToken();
      this.repo.insertSession(lawyerId, token, nowMs);
      return { ok: true, token, lawyerId };
    });
  }

  /** Heartbeat (and any authenticated action): extends a live session. Null if it has ended. */
  touch(token: string): string | null {
    return this.repo.touchLiveSession(token, this.clock.now(), this.ttlMs) ?? null;
  }

  release(token: string): void {
    this.repo.deleteSession(token);
  }

  lawyersInUse(): Set<string> {
    return this.repo.liveLawyerIds(this.clock.now(), this.ttlMs);
  }
}
