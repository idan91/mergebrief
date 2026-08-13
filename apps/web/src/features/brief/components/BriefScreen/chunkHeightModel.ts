// Shared height model for chunk cards: the CSS paint-skip estimate and the
// window virtualizer must agree on what a not-yet-rendered card is worth, or
// scroll targets drift as real heights reveal.
// DIFF_ROW_HEIGHT_PX is in lockstep with `DiffTable.module.scss`'s
// `contain-intrinsic-block-size` row height — change both or neither.

export const DIFF_ROW_HEIGHT_PX = 22;

/** Card chrome around the diff table: head row, chips, paddings, card gap. */
export const CHUNK_CARD_OVERHEAD_PX = 96;

/** A collapsed card renders its head only. */
export const COLLAPSED_CARD_HEIGHT_PX = 56;

export interface ChunkCardSizeInput {
  /** Rendered diff rows (`chunk.diff.length`), 0 for a missing diff. */
  diffRowCount: number;
  open: boolean;
}

export function estimateChunkCardHeight(input: ChunkCardSizeInput): number {
  if (!input.open) return COLLAPSED_CARD_HEIGHT_PX;
  return input.diffRowCount * DIFF_ROW_HEIGHT_PX + CHUNK_CARD_OVERHEAD_PX;
}
