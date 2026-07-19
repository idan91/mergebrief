import type { Brief, Category, RiskSurfaceAttribute } from "brief-core/types";

/**
 * Query helpers for property checklists (BRIEF-59 decision 2): anchor on
 * run-stable facts — files, groups, attribute names, order relations —
 * never on chunk boundaries or free-prose text.
 */

/** Chunks whose file path ends with `suffix` (fixture paths are repo-relative). */
export function chunksFor(brief: Brief, suffix: string) {
  return brief.chunks.filter((chunk) => chunk.file.endsWith(suffix));
}

/** Deduped ids of the groups carrying any chunk of `suffix`. */
export function groupIdsFor(brief: Brief, suffix: string): string[] {
  return [...new Set(chunksFor(brief, suffix).map((c) => c.changeGroupId))];
}

/** True when any chunk (optionally scoped to a file suffix) fires `attr`. */
export function fires(
  brief: Brief,
  attr: RiskSurfaceAttribute,
  suffix?: string,
): boolean {
  const chunks = suffix === undefined ? brief.chunks : chunksFor(brief, suffix);
  return chunks.some((chunk) => chunk.riskSurface.includes(attr));
}

export function dominantCategories(brief: Brief): Category[] {
  return brief.changeGroups.map((group) => group.dominantCategory);
}

/** Group ids in presentation order: the reading order when present,
 * source order otherwise — matches how a reviewer meets them. */
export function orderedGroupIds(brief: Brief): string[] {
  return (
    brief.readingOrder?.map((step) => step.groupId) ??
    brief.changeGroups.map((group) => group.id)
  );
}

/** Position of the FIRST group satisfying `pick`, in presentation order;
 * Infinity when none does (comparisons then fail the property). */
export function firstGroupIndex(
  brief: Brief,
  pick: (groupId: string) => boolean,
): number {
  const index = orderedGroupIds(brief).findIndex(pick);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}
