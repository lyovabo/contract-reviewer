import { findingKey } from './finding-key';
import type { ReviewHistoryEntry, ReviewView } from './types';

/**
 * A document's reviews, newest first, each completed one compared with the previous completed
 * one: its findings are marked new or unchanged, and the earlier review's findings it did not
 * report are listed as no longer flagged.
 *
 * A failed or running review is never compared, and never counts as "the previous one": its
 * findings are incomplete, so a comparison would show issues as dropped that it never reached.
 * The reviews themselves stay independent: this only reads what each one found.
 */
export function compareWithPrevious(newestFirst: ReviewView[]): ReviewHistoryEntry[] {
  return newestFirst.map((review, index) => {
    const previous =
      review.status === 'completed'
        ? newestFirst.slice(index + 1).find((older) => older.status === 'completed')
        : undefined;
    if (!previous) {
      return {
        ...review,
        findings: review.findings.map((finding) => ({ ...finding, change: null })),
        comparedWith: null,
        noLongerFlagged: [],
      };
    }
    const before = new Set(previous.findings.map(findingKey));
    const now = new Set(review.findings.map(findingKey));
    return {
      ...review,
      findings: review.findings.map((finding) => ({
        ...finding,
        change: before.has(findingKey(finding)) ? 'unchanged' : 'new',
      })),
      comparedWith: { id: previous.id, requestedAt: previous.requestedAt },
      noLongerFlagged: previous.findings.filter((finding) => !now.has(findingKey(finding))),
    };
  });
}
