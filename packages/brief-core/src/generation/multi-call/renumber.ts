import type { StoredGrouping } from "../../types";
import { restoreRawGroupIds } from "../untrusted-text";
import type { StoredGroupIds } from "./types";

/**
 * A stored grouping's group ids against the grouping this run reads, both
 * ways. The run stores the grouping it reads, so the two pair id for id.
 */
export function mapStoredGroupIds(
  stored: StoredGrouping,
  current: StoredGrouping,
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
 * merge drops it.
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
