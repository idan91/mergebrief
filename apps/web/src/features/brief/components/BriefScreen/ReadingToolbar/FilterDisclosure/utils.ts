// Closure-free trigger-label logic, so it is directly unit-testable.
import type { ConversationFilter } from "@web/features/conversation/utils/filter";
import type { TFunction } from "i18next";

/**
 * The `N noun` receipts following the trigger's `Filter` label while active:
 * selected verdicts, selected reviewers, then the hidden-inline-thread count,
 * always last. Zero-count entries contribute nothing, and an inactive filter,
 * recency alone not counting, yields an empty list and a plain `Filter` trigger.
 */
export function filterTriggerSegments(
  t: TFunction,
  filter: ConversationFilter,
  hiddenInlineThreads: number,
): readonly string[] {
  const segments: string[] = [];
  if (filter.verdicts.size > 0) {
    segments.push(
      t("brief.toolbar.filterVerdicts", { count: filter.verdicts.size }),
    );
  }
  if (filter.reviewers.size > 0) {
    segments.push(
      t("brief.toolbar.filterReviewers", { count: filter.reviewers.size }),
    );
  }
  if (segments.length > 0 && hiddenInlineThreads > 0) {
    segments.push(
      t("brief.toolbar.filterHidden", { count: hiddenInlineThreads }),
    );
  }
  return segments;
}
