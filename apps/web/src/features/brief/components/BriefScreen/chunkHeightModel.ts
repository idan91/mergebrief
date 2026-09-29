// Shared height model for chunk cards: the CSS paint-skip estimate and the
// window virtualizer must agree on what a not-yet-rendered card is worth, or
// scroll targets drift as real heights reveal.
// DIFF_ROW_HEIGHT_PX is in lockstep with the row line-height in
// `DiffRows.module.scss` and with `DiffTable.module.scss`'s
// `contain-intrinsic-block-size` estimate: change all three or none. It is
// one line; a wrapped row is a multiple, so the estimate is a lower bound
// that `measureElement` and the painted size correct after first paint.

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

/** The "diff unavailable" note a diff-less open card renders instead of rows. */
export const EMPTY_DIFF_NOTE_PX = 40;

export function estimateChunkCardHeight(input: ChunkCardSizeInput): number {
  if (!input.open) return COLLAPSED_CARD_HEIGHT_PX;
  if (input.diffRowCount === 0) {
    return CHUNK_CARD_OVERHEAD_PX + EMPTY_DIFF_NOTE_PX;
  }
  return input.diffRowCount * DIFF_ROW_HEIGHT_PX + CHUNK_CARD_OVERHEAD_PX;
}

/** Narrative card chrome: the head with its action, summary paragraph, margins. */
export const NARRATIVE_CARD_OVERHEAD_PX = 145;

/** The removed-lines note under a card's rows. */
export const REMOVED_NOTE_PX = 24;

export interface NarrativeCardSizeInput {
  /** Rows the card's guest table renders, removed lines included. */
  rowCount: number;
  hasRemovedNote: boolean;
}

export function estimateNarrativeCardHeight(
  input: NarrativeCardSizeInput,
): number {
  return (
    input.rowCount * DIFF_ROW_HEIGHT_PX +
    NARRATIVE_CARD_OVERHEAD_PX +
    (input.hasRemovedNote ? REMOVED_NOTE_PX : 0)
  );
}
