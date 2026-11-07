export interface ChunkStepTargets {
  previous?: string;
  next?: string;
}

/**
 * The chunks Previous and Next land on. With no active chunk, Next opens the
 * first and Previous has nowhere to go.
 */
export function resolveChunkStepTargets(
  chunkIds: readonly string[],
  activeChunkId: string | undefined,
): ChunkStepTargets {
  const index =
    activeChunkId === undefined ? -1 : chunkIds.indexOf(activeChunkId);
  const targets: ChunkStepTargets = {};
  if (index === -1) {
    const first = chunkIds[0];
    if (first !== undefined) {
      targets.next = first;
    }
    return targets;
  }

  const previous = chunkIds[index - 1];
  if (previous !== undefined) {
    targets.previous = previous;
  }
  const next = chunkIds[index + 1];
  if (next !== undefined) {
    targets.next = next;
  }
  return targets;
}
