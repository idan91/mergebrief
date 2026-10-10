import type { GroupView } from "../../../../../model/utils/view-model";
import type { ChunkSteps } from "./types";

/** The chunks J and K land on from the active one, in reading order. */
export function deriveChunkSteps(
  groups: GroupView[],
  activeChunkId: string | null,
): ChunkSteps {
  const positions = groups.flatMap((group) =>
    group.chunks.map((chunk) => ({ chunkId: chunk.id, groupId: group.id })),
  );
  const index = positions.findIndex(
    (position) => position.chunkId === activeChunkId,
  );
  const current = positions[index];
  const steps: ChunkSteps = {};
  if (!current) {
    return steps;
  }

  const previous = positions[index - 1];
  if (previous) {
    steps.previous = {
      chunkId: previous.chunkId,
      crossesGroup: previous.groupId !== current.groupId,
    };
  }
  const next = positions[index + 1];
  if (next) {
    steps.next = {
      chunkId: next.chunkId,
      crossesGroup: next.groupId !== current.groupId,
    };
  }
  return steps;
}
