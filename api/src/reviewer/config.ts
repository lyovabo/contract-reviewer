import type { ClaudeSettings, Effort } from './claude-reviewer';

export type ReviewerChoice = { kind: 'fake' } | ({ kind: 'claude' } & ClaudeSettings);

/** Below this, not even a short contract fits with room to answer. */
export const MIN_TOKEN_BUDGET = 5_000;

export const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'] satisfies Effort[];

/** An Anthropic API key is set: what lets the server call Claude, and so offer it. */
export const hasApiKey = (env: Record<string, string | undefined>) => !!env.ANTHROPIC_API_KEY?.trim();

/**
 * Claude's settings: those in config.json, with these variables on top (from the shell or api/.env):
 *   REVIEWER_MODEL    a Claude model id
 *   REVIEWER_EFFORT   low, medium, high, xhigh or max
 *   REVIEWER_THINKING off or on
 *   REVIEWER_TOKEN_BUDGET  hard limit per review, input and output over all turns
 * They are checked even without an API key, so a wrong value always stops the API at startup.
 */
export function claudeSettingsFromEnv(env: Record<string, string | undefined>, settings: ClaudeSettings): ClaudeSettings {
  const effort = env.REVIEWER_EFFORT || settings.effort;
  if (!EFFORTS.includes(effort)) throw new Error(`REVIEWER_EFFORT must be one of ${EFFORTS.join(', ')}, not "${effort}"`);
  const thinking = env.REVIEWER_THINKING || (settings.thinking ? 'on' : 'off');
  if (thinking !== 'on' && thinking !== 'off') throw new Error(`REVIEWER_THINKING must be "on" or "off", not "${thinking}"`);
  const budget = env.REVIEWER_TOKEN_BUDGET || String(settings.tokenBudget);
  if (!/^\d+$/.test(budget) || Number(budget) < MIN_TOKEN_BUDGET) {
    throw new Error(`REVIEWER_TOKEN_BUDGET must be a whole number of at least ${MIN_TOKEN_BUDGET}, not "${budget}"`);
  }
  return {
    ...settings,
    model: env.REVIEWER_MODEL || settings.model,
    effort: effort as Effort,
    thinking: thinking === 'on',
    tokenBudget: Number(budget),
  };
}

/**
 * Which AIs the server offers. The simulated one always. Claude too when an Anthropic API key is
 * set (ANTHROPIC_API_KEY, in the shell or api/.env): the key is the switch, and lawyers then choose
 * the AI per review in the app, with the simulated one as the default. The key is only ever read
 * from the environment, so no committed file can switch on paid calls.
 */
export function reviewerFromEnv(env: Record<string, string | undefined>, settings: ClaudeSettings): ReviewerChoice {
  const claude = claudeSettingsFromEnv(env, settings);
  return hasApiKey(env) ? { kind: 'claude', ...claude } : { kind: 'fake' };
}

export const describeReviewer = (choice: ReviewerChoice) =>
  choice.kind === 'fake'
    ? 'simulated AI only (no ANTHROPIC_API_KEY, so Claude is not offered)'
    : `simulated AI, or Claude when a lawyer chooses it (API key found; ${choice.model}, effort ${choice.effort}, ` +
      `thinking ${choice.thinking ? 'on' : 'off'}, at most ${choice.tokenBudget} tokens per review)`;
