import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from './bootstrap';
import type { Logger } from './domain/review-service';
import { systemScheduler } from './domain/time';
import { anthropicApi } from './reviewer/claude-reviewer';
import { describeReviewer } from './reviewer/config';
import { claudeReviewerFactory, startupSettings } from './startup';

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

// Optional local settings (api/.env, git-ignored): the reviewer switch, the API key, CONFIG_FILE.
const envFile = here('../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 4000);
const dbPath = process.env.DB_PATH ?? here('../data/contract-reviewer.db');
const samplesDir = process.env.SAMPLES_DIR ?? here('../../samples');
// The rules and timings (api/config.json, or the file CONFIG_FILE names) and the reviewer choice.
// A wrong value stops here, before the database is opened.
const settings = startupSettings(process.env);
const { configFile, config, reviewer } = settings;

const logger: Logger = {
  info: (message) => console.log(`[api] ${message}`),
  error: (message, err) => console.error(`[api] ${message}`, err ?? ''),
};

// The simulated AI is always offered. With ANTHROPIC_API_KEY set, Claude is too, and lawyers choose
// per review in the app. Everything else is the same either way.
const claudeFactory = claudeReviewerFactory(settings, {
  api: () => anthropicApi(),
  scheduler: systemScheduler,
  log: logger.info,
});

const server = createServer({ dbPath, samplesDir, config, logger, claudeReviewerFactory: claudeFactory });
logger.info(
  `settings (${configFile}): reviews stop after ${config.reviewDeadlineMs} ms, ` +
    `${config.monthlyReviewLimit} reviews a month, sessions end ${config.sessionTtlMs} ms after the last heartbeat`,
);
logger.info(`reviewers: ${describeReviewer(reviewer)}`);
if (process.env.REVIEWER) {
  logger.info('REVIEWER is no longer used: Claude is offered whenever ANTHROPIC_API_KEY is set.');
}
logger.info(
  `startup sweep: ${server.sweep.timedOut} timed out, ${server.sweep.interrupted} interrupted (db: ${dbPath})`,
);

const http = server.app.listen(port, () => logger.info(`listening on http://localhost:${port}`));

function shutdown() {
  http.close(() => {
    server.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
