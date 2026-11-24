import type { Finding } from './types';

/** Straight quotes and single spaces, so the same sentence is not told apart by typography. */
export const normalizeQuote = (text: string) =>
  text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/**
 * Which issue a finding is about: its clause and its quote (or its title, for something the
 * contract leaves out), ignoring quote style, spacing and letter case. Two findings with the same
 * key are the same issue. The Claude reviewer drops repeats with it, and the review history uses
 * it to compare a review with the one before.
 */
export const findingKey = (finding: Pick<Finding, 'clause' | 'excerpt' | 'title'>) =>
  `${finding.clause ?? ''}|${normalizeQuote(finding.excerpt ?? finding.title).toLowerCase()}`;
