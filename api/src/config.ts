import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MIN_OUTPUT_TOKENS, type ClaudeSettings, type Effort } from './reviewer/claude-reviewer';
import { EFFORTS, MIN_TOKEN_BUDGET } from './reviewer/config';
import type { FakeReviewerSettings } from './reviewer/fake-reviewer';

/**
 * The app's rules and timings. They are read from api/config.json at startup, and nowhere else in
 * the code holds a copy of them. CONFIG_FILE points to another file, for a demo for example.
 */
export interface AppConfig {
  /** A review still running this long after it was requested has failed for good (ms). */
  reviewDeadlineMs: number;
  /** Reviews one workspace may complete per UTC calendar month. */
  monthlyReviewLimit: number;
  /** A session with no heartbeat for this long has ended (ms). The web app heartbeats every third of it. */
  sessionTtlMs: number;
  fakeReviewer: FakeReviewerSettings;
  /** The Claude reviewer's settings. The REVIEWER_* environment variables override them. */
  claudeReviewer: ClaudeSettings;
}

export const DEFAULT_CONFIG_FILE = fileURLToPath(new URL('../config.json', import.meta.url));

export const configFileFromEnv = (env: Record<string, string | undefined>) => env.CONFIG_FILE || DEFAULT_CONFIG_FILE;

/** Reads and checks the settings file. A missing file or a wrong value stops the API at startup. */
export function loadConfig(path: string): AppConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read the settings file ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseConfig(raw, path);
}

/**
 * The longest time any setting may be. Timers cannot wait longer than about 24.8 days (a longer
 * wait fires at once), and no rule here needs more than an hour.
 */
const MAX_TIME_MS = 3_600_000;

/**
 * Checks every value and refuses unknown keys, so a misspelt setting stops the API instead of
 * being ignored. Each error names the setting and the file.
 */
export function parseConfig(raw: unknown, source = 'the settings'): AppConfig {
  const check = checker(source);
  const root = check.object(raw, '', [
    'reviewDeadlineMs',
    'monthlyReviewLimit',
    'sessionTtlMs',
    'fakeReviewer',
    'claudeReviewer',
  ]);

  const fake = check.object(root.fakeReviewer, 'fakeReviewer', ['normalMs', 'slowMs', 'outcomePercent']);
  const percent = check.object(fake.outcomePercent, 'fakeReviewer.outcomePercent', ['normal', 'error', 'slow']);
  const outcomePercent = {
    normal: check.whole(percent.normal, 'fakeReviewer.outcomePercent.normal', 0),
    error: check.whole(percent.error, 'fakeReviewer.outcomePercent.error', 0),
    slow: check.whole(percent.slow, 'fakeReviewer.outcomePercent.slow', 0),
  };
  if (outcomePercent.normal + outcomePercent.error + outcomePercent.slow !== 100) {
    check.fail('fakeReviewer.outcomePercent', 'must add up to 100');
  }

  const claude = check.object(root.claudeReviewer, 'claudeReviewer', [
    'model',
    'effort',
    'thinking',
    'tokenBudget',
    'maxTurns',
    'maxOutputTokens',
  ]);
  if (typeof claude.model !== 'string' || claude.model.trim() === '') {
    check.fail('claudeReviewer.model', 'must be a model name', claude.model);
  }
  if (typeof claude.effort !== 'string' || !EFFORTS.includes(claude.effort)) {
    check.fail('claudeReviewer.effort', `must be one of ${EFFORTS.join(', ')}`, claude.effort);
  }
  if (typeof claude.thinking !== 'boolean') {
    check.fail('claudeReviewer.thinking', 'must be true or false', claude.thinking);
  }

  // The fake's runs must sit on the right side of the deadline: normal runs finish before it,
  // slow runs reach it and time out (one of exactly the deadline completes on the deadline tick,
  // which is already too late).
  const reviewDeadlineMs = check.whole(root.reviewDeadlineMs, 'reviewDeadlineMs', 1_000, MAX_TIME_MS);
  const normalMs = check.range(fake.normalMs, 'fakeReviewer.normalMs', MAX_TIME_MS);
  const slowMs = check.range(fake.slowMs, 'fakeReviewer.slowMs', MAX_TIME_MS);
  if (normalMs.max >= reviewDeadlineMs) {
    const rule = `must be below reviewDeadlineMs (${reviewDeadlineMs}), so normal runs can finish`;
    check.fail('fakeReviewer.normalMs.max', rule, normalMs.max);
  }
  if (slowMs.min < reviewDeadlineMs) {
    const rule = `must be at least reviewDeadlineMs (${reviewDeadlineMs}), so slow runs time out`;
    check.fail('fakeReviewer.slowMs.min', rule, slowMs.min);
  }

  return {
    reviewDeadlineMs,
    monthlyReviewLimit: check.whole(root.monthlyReviewLimit, 'monthlyReviewLimit', 1),
    sessionTtlMs: check.whole(root.sessionTtlMs, 'sessionTtlMs', 3_000, MAX_TIME_MS),
    fakeReviewer: { normalMs, slowMs, outcomePercent },
    claudeReviewer: {
      model: claude.model as string,
      effort: claude.effort as Effort,
      thinking: claude.thinking as boolean,
      tokenBudget: check.whole(claude.tokenBudget, 'claudeReviewer.tokenBudget', MIN_TOKEN_BUDGET),
      maxTurns: check.whole(claude.maxTurns, 'claudeReviewer.maxTurns', 1),
      maxOutputTokens: check.whole(claude.maxOutputTokens, 'claudeReviewer.maxOutputTokens', MIN_OUTPUT_TOKENS),
    },
  };
}

/** Small checks that throw an error naming the setting, its value and the file. */
function checker(source: string) {
  const shown = (value: unknown) => (value === undefined ? 'missing' : JSON.stringify(value));

  function fail(path: string, rule: string, ...value: unknown[]): never {
    const found = value.length > 0 ? ` (it is ${shown(value[0])})` : '';
    throw new Error(`${source}: ${path || 'the settings'} ${rule}${found}`);
  }

  function object(value: unknown, path: string, keys: string[]): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object', value);
    const record = value as Record<string, unknown>;
    const unknown = Object.keys(record).find((key) => !keys.includes(key));
    if (unknown) fail(path ? `${path}.${unknown}` : unknown, `is not a setting. Settings here: ${keys.join(', ')}`);
    return record;
  }

  function whole(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      const rule = max === Number.MAX_SAFE_INTEGER ? `of at least ${min}` : `from ${min} to ${max}`;
      fail(path, `must be a whole number ${rule}`, value);
    }
    return value;
  }

  function range(value: unknown, path: string, max: number): { min: number; max: number } {
    const record = object(value, path, ['min', 'max']);
    const low = whole(record.min, `${path}.min`, 0, max);
    const high = whole(record.max, `${path}.max`, 0, max);
    if (high < low) fail(`${path}.max`, `must be at least ${path}.min (${low})`, high);
    return { min: low, max: high };
  }

  return { fail, object, whole, range };
}
