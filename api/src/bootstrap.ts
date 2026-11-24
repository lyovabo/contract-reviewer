import { buildHttpApp } from './app';
import type { AppConfig } from './config';
import { openDatabase } from './db/connection';
import { createRepository } from './db/repository';
import { loadSamples, seed } from './db/seed';
import { ReviewService, silentLogger, type Logger } from './domain/review-service';
import { SessionService } from './domain/sessions';
import { systemClock, systemScheduler, type Clock, type Scheduler } from './domain/time';
import { createFakeReviewer, type Rng } from './reviewer/fake-reviewer';
import type { ReviewerFactory } from './reviewer/port';

export interface ServerOptions {
  dbPath: string;
  samplesDir: string;
  /** The rules and timings, from config.json (see config.ts). */
  config: AppConfig;
  clock?: Clock;
  scheduler?: Scheduler;
  rng?: Rng;
  /** The simulated AI. Defaults to the in-process fake driven by `rng` and `scheduler`. */
  reviewerFactory?: ReviewerFactory;
  /** Claude. Lawyers can choose it only when this is given. */
  claudeReviewerFactory?: ReviewerFactory;
  newId?: () => string;
  logger?: Logger;
}

/**
 * Composition root, shared by `main.ts` and the tests: open the DB, seed it, apply the restart
 * policy, wire the domain to the reviewer and HTTP.
 */
export function createServer(options: ServerOptions) {
  const clock = options.clock ?? systemClock;
  const scheduler = options.scheduler ?? systemScheduler;
  const logger = options.logger ?? silentLogger;
  const rng = options.rng ?? Math.random;
  const { config } = options;

  const db = openDatabase(options.dbPath, config.reviewDeadlineMs);
  seed(db, loadSamples(options.samplesDir));
  const repo = createRepository(db);

  const service = new ReviewService({
    repo,
    clock,
    scheduler,
    logger,
    newId: options.newId,
    reviewDeadlineMs: config.reviewDeadlineMs,
    monthlyReviewLimit: config.monthlyReviewLimit,
    reviewerFactory:
      options.reviewerFactory ??
      ((listener) => createFakeReviewer(listener, { rng, scheduler, settings: config.fakeReviewer })),
    claudeReviewerFactory: options.claudeReviewerFactory,
  });
  const sweep = service.startupSweep();
  const sessions = new SessionService(repo, clock, config.sessionTtlMs);
  const app = buildHttpApp(service, sessions, logger);

  return {
    app,
    service,
    sessions,
    repo,
    db,
    sweep,
    close() {
      service.dispose();
      db.close();
    },
  };
}

export type Server = ReturnType<typeof createServer>;
