import type { GroupingGeneration } from "../../types";
import { restoreRawGroupIds } from "../untrusted-text";
import type { StoredGroupIds } from "./types";

/** `g1`, `g2`, ... skipping every reserved id, one per distinct id in list order. */
function mintGroupIds(
  ids: readonly string[],
  reserved: ReadonlySet<string>,
): Map<string, string> {
  const minted = new Map<string, string>();
  let counter = 1;
  for (const id of ids) {
    if (minted.has(id)) {
      continue;
    }
    let candidate = `g${counter}`;
    while (reserved.has(candidate)) {
      counter += 1;
      candidate = `g${counter}`;
    }
    counter += 1;
    minted.set(id, candidate);
  }
  return minted;
}

/** Every id the grouping refers to without listing it as a group. */
function listStrayIds(grouping: GroupingGeneration): string[] {
  const listed = new Set(grouping.changeGroups.map((group) => group.id));
  const referenced = [
    ...grouping.hunkMap.map((entry) => entry.groupId),
    ...(grouping.readingOrder ?? []).map((step) => step.groupId),
    ...grouping.intentCheck.items.flatMap((item) => item.groupIds),
  ];
  return referenced.filter((id) => !listed.has(id));
}

/**
 * The grouping's group ids re-minted past every id the PR's brief chain has
 * used, so a retired id never comes back on an unrelated group, with the hunk
 * map, the reading order and the intent items re-pointed. A reference to a
 * group the list lacks stays as written, and no minted id takes its spelling,
 * so it still fails the hunk map resolver.
 */
export function renumberGroupIds(
  grouping: GroupingGeneration,
  reservedIds: readonly string[],
): GroupingGeneration {
  const listedIds = grouping.changeGroups.map((group) => group.id);
  const reserved = new Set([...reservedIds, ...listStrayIds(grouping)]);
  const minted = mintGroupIds(listedIds, reserved);
  const rename = (id: string): string => minted.get(id) ?? id;

  const renumbered: GroupingGeneration = {
    ...grouping,
    changeGroups: grouping.changeGroups.map((group) => ({
      ...group,
      id: rename(group.id),
    })),
    hunkMap: grouping.hunkMap.map((entry) => ({
      ...entry,
      groupId: rename(entry.groupId),
    })),
    intentCheck: {
      ...grouping.intentCheck,
      items: grouping.intentCheck.items.map((item) => ({
        ...item,
        groupIds: item.groupIds.map(rename),
      })),
    },
  };
  if (grouping.readingOrder !== undefined) {
    renumbered.readingOrder = grouping.readingOrder.map((step) => ({
      ...step,
      groupId: rename(step.groupId),
    }));
  }
  return renumbered;
}

/**
 * A stored grouping's group ids against this run's renumbering of it, both
 * ways. Both list their groups in the same order.
 */
export function mapStoredGroupIds(
  stored: GroupingGeneration,
  current: GroupingGeneration,
): StoredGroupIds {
  const toRun = new Map<string, string>();
  const toStored = new Map<string, string>();
  stored.changeGroups.forEach((group, position) => {
    const currentId = current.changeGroups[position]?.id;
    if (currentId !== undefined) {
      toRun.set(group.id, currentId);
      toStored.set(currentId, group.id);
    }
  });
  return { toRun, toStored };
}

/**
 * Chunks re-pointed through `renames`, each id read in its sanitized
 * spelling too. A chunk naming a group the map lacks is dropped, as the
 * merge drops it, so a later run's renumbering never lands it on a group.
 */
export function renameChunkGroupIds<
  GroupChunk extends { readonly changeGroupId: string },
>(
  chunks: readonly GroupChunk[],
  renames: ReadonlyMap<string, string>,
): GroupChunk[] {
  const restored = restoreRawGroupIds(chunks, [...renames.keys()]);
  return restored.flatMap((chunk) => {
    const renamed = renames.get(chunk.changeGroupId);
    return renamed === undefined ? [] : [{ ...chunk, changeGroupId: renamed }];
  });
}
