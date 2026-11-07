import type { BriefChunk } from "../../../../model/types";
import type { GroupView } from "../../../../model/utils/view-model";

/** The chunk a row names; undefined when nothing on the page carries the id. */
export function findChunkById(
  groups: readonly GroupView[],
  chunkId: string | undefined,
): BriefChunk | undefined {
  if (chunkId === undefined) {
    return undefined;
  }
  for (const group of groups) {
    const chunk = group.chunks.find((candidate) => candidate.id === chunkId);
    if (chunk !== undefined) {
      return chunk;
    }
  }
  return undefined;
}
