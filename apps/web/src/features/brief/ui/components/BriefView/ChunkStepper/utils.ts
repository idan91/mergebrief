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

/** The reader sits between two chunks, beside the active one. */
export interface ChunkGap {
  /** The active chunk lies below the reader rather than above. */
  activeBelowReader: boolean;
}

/** Previous and Next from a gap: the chunks on either side of it. */
export function resolveGapStepTargets(
  chunkIds: readonly string[],
  activeChunkId: string | undefined,
  gap: ChunkGap,
): ChunkStepTargets {
  const around = resolveChunkStepTargets(chunkIds, activeChunkId);
  const activeListed =
    activeChunkId !== undefined && chunkIds.includes(activeChunkId);
  if (!activeListed) {
    return around;
  }

  const targets: ChunkStepTargets = {};
  if (gap.activeBelowReader) {
    targets.next = activeChunkId;
    if (around.previous !== undefined) {
      targets.previous = around.previous;
    }
  } else {
    targets.previous = activeChunkId;
    if (around.next !== undefined) {
      targets.next = around.next;
    }
  }
  return targets;
}
