import { IntentBuckets, type Chunk, type IntentCheck } from "../../types";
import type { WarningCollector } from "../warnings/types";
import type { GroupSections } from "./types";

const EMPTY_GROUP_CHECK = "empty group";

function pruneIntentAnchors(
  intentCheck: IntentCheck,
  droppedIds: ReadonlySet<string>,
): IntentCheck {
  const pruned: IntentCheck = { ...intentCheck };
  for (const bucket of Object.values(IntentBuckets)) {
    pruned[bucket] = intentCheck[bucket].map((item) => ({
      ...item,
      groupIds: item.groupIds.filter((id) => !droppedIds.has(id)),
    }));
  }
  return pruned;
}

/**
 * Drops every group no final chunk names, with its reading-order step and
 * its intent anchors; other references stay as written for validation. It
 * runs on the merged brief, after stored parts were paired by group
 * position, so a resume pairs them the same way.
 */
export function dropEmptyGroups(
  sections: GroupSections,
  chunks: readonly Pick<Chunk, "changeGroupId">[],
  warnings: WarningCollector,
): GroupSections {
  const namedIds = new Set(chunks.map((chunk) => chunk.changeGroupId));
  const dropped = sections.changeGroups.filter(
    (group) => !namedIds.has(group.id),
  );
  if (dropped.length === 0) {
    return sections;
  }
  warnings.reportIssues(
    EMPTY_GROUP_CHECK,
    dropped.map(
      (group) =>
        `group ${group.id} has no chunks, dropped with its reading-order step and intent anchors`,
    ),
  );

  const droppedIds = new Set(dropped.map((group) => group.id));
  const kept: GroupSections = {
    changeGroups: sections.changeGroups.filter(
      (group) => !droppedIds.has(group.id),
    ),
    intentCheck: pruneIntentAnchors(sections.intentCheck, droppedIds),
  };
  if (sections.readingOrder !== undefined) {
    kept.readingOrder = sections.readingOrder.filter(
      (step) => !droppedIds.has(step.groupId),
    );
  }
  return kept;
}
