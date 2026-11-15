import type { ValueOf } from "types";

import type { InboxItem } from "../../types";

/** Where an archive or a delete was asked from: a row's menu, or the selection bar. */
export const ArchiveScopes = {
  ROW: "row",
  SELECTION: "selection",
} as const;
export type ArchiveScope = ValueOf<typeof ArchiveScopes>;

/** The delete the modal is confirming, with where it was asked from. */
export interface PendingDelete {
  readonly items: readonly InboxItem[];
  readonly scope: ArchiveScope;
}

/** The keyboard cursor: its index in the rendered rows, -1 unplaced, and its key moves. */
export interface InboxCursor {
  readonly index: number;
  readonly moveCount: number;
  /** Puts the cursor on the row focus entered; not a key move, so nothing scrolls or refocuses. */
  readonly setCursorRow: (index: number) => void;
}
