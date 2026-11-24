import { normalizeQuote } from '../domain/finding-key';
import type { Finding, Severity } from '../domain/types';

const SEVERITIES: readonly string[] = ['high', 'medium', 'low'] satisfies Severity[];
const MAX_LENGTH = { clause: 30, title: 120, excerpt: 600, explanation: 1_200 };

export type CheckedFinding = { ok: true; finding: Finding } | { ok: false; reason: string };

/** True if `excerpt` appears word for word in `text`. */
export const isQuotedFrom = (text: string, excerpt: string) => normalizeQuote(text).includes(normalizeQuote(excerpt));

/**
 * Checks one finding reported by a model. The input is untrusted: it may be truncated, mistyped
 * or made up, so every field is checked, and the excerpt must really be in the contract. A
 * rejection's reason is written for the model, which gets it back and may report the issue again.
 */
export function checkFinding(input: unknown, contractText: string): CheckedFinding {
  if (typeof input !== 'object' || input === null) return reject('The input must be an object.');
  const { clause, title, severity, excerpt, explanation } = input as Record<string, unknown>;

  if (!isOptionalText(clause, MAX_LENGTH.clause)) {
    return reject(`clause must be text of at most ${MAX_LENGTH.clause} characters, or null.`);
  }
  if (!isText(title, MAX_LENGTH.title)) return reject(`title must be text of 1 to ${MAX_LENGTH.title} characters.`);
  if (typeof severity !== 'string' || !SEVERITIES.includes(severity)) {
    return reject('severity must be "high", "medium" or "low".');
  }
  if (!isOptionalText(excerpt, MAX_LENGTH.excerpt)) {
    return reject(`excerpt must be text of at most ${MAX_LENGTH.excerpt} characters, or null.`);
  }
  if (!isText(explanation, MAX_LENGTH.explanation)) {
    return reject(`explanation must be text of 1 to ${MAX_LENGTH.explanation} characters.`);
  }

  const quote = blankToNull(excerpt);
  if (quote !== null && !isQuotedFrom(contractText, quote)) {
    return reject(
      'The excerpt is not word for word in the contract. Copy the sentence exactly as written, ' +
        'or use null if the issue is something the contract leaves out.',
    );
  }
  return {
    ok: true,
    finding: {
      clause: blankToNull(clause),
      title: (title as string).trim(),
      severity: severity as Severity,
      excerpt: quote,
      explanation: (explanation as string).trim(),
    },
  };
}

const reject = (reason: string): CheckedFinding => ({ ok: false, reason });

const isText = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** A missing field counts as null: the schema requires it, but a model can still leave it out. */
const isOptionalText = (value: unknown, max: number) =>
  value === null || value === undefined || (typeof value === 'string' && value.length <= max);

const blankToNull = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
