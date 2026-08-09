// Closure-free trigger-label logic (ADR 0037): directly unit-testable.
import type { ConversationFilter } from "@web/features/conversation/utils/filter";

/**
 * The `N noun` receipts following the trigger's `Filter` label while the
 * filter is active (BRIEF-134 spec): selected verdicts, selected reviewers,
 * then the hidden-inline-thread count — the critical number, always
 * last. Zero-count entries contribute nothing; an inactive filter (recency
 * alone does not count) yields an empty list and a plain `Filter` trigger.
 */
export function filterTriggerSegments(
  filter: ConversationFilter,
  hiddenInlineThreads: number,
): readonly string[] {
  const segments: string[] = [];
  if (filter.verdicts.size > 0) {
    segments.push(
      `${filter.verdicts.size} verdict${filter.verdicts.size === 1 ? "" : "s"}`,
    );
  }
  if (filter.reviewers.size > 0) {
    segments.push(
      `${filter.reviewers.size} reviewer${
        filter.reviewers.size === 1 ? "" : "s"
      }`,
    );
  }
  if (segments.length > 0 && hiddenInlineThreads > 0) {
    segments.push(`${hiddenInlineThreads} hidden`);
  }
  return segments;
}
