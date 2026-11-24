import { configFileFromEnv, loadConfig, type AppConfig } from './config';
import type { Scheduler } from './domain/time';
import { createClaudeReviewer, type ClaudeApi } from './reviewer/claude-reviewer';
import { reviewerFromEnv, type ReviewerChoice } from './reviewer/config';
import type { ReviewerFactory } from './reviewer/port';

/** What the API reads at startup. main.ts and scripts/show-request.ts both use it. */
export interface StartupSettings {
  configFile: string;
  config: AppConfig;
  reviewer: ReviewerChoice;
}

/**
 * The settings file (api/config.json, or CONFIG_FILE), then the reviewer choice from the
 * environment, whose REVIEWER_* variables override the file's Claude settings. Throws on a
 * wrong value, so the API stops before it opens the database.
 */
export function startupSettings(env: Record<string, string | undefined>): StartupSettings {
  const configFile = configFileFromEnv(env);
  const config = loadConfig(configFile);
  return { configFile, config, reviewer: reviewerFromEnv(env, config.claudeReviewer) };
}

/**
 * Claude, when an Anthropic API key is set: lawyers can then choose it per review. Undefined
 * otherwise, so only the simulated AI is offered. The Claude client is only made with a key.
 */
export function claudeReviewerFactory(
  settings: StartupSettings,
  deps: { api: () => ClaudeApi; scheduler: Scheduler; log?: (message: string) => void },
): ReviewerFactory | undefined {
  if (settings.reviewer.kind !== 'claude') return undefined;
  const { kind: _, ...claude } = settings.reviewer;
  const api = deps.api();
  return (listener) =>
    createClaudeReviewer(listener, {
      api,
      scheduler: deps.scheduler,
      settings: claude,
      deadlineMs: settings.config.reviewDeadlineMs,
      log: deps.log,
    });
}
