import type { CommentAnchor } from "../../utils/comments";

export const ComposerStateKinds = {
  CLOSED: "closed",
  OPEN: "open",
  SAVING: "saving",
  REANCHORING: "reanchoring",
} as const;

export interface ClosedComposerState {
  kind: typeof ComposerStateKinds.CLOSED;
}

export interface OpenComposerState {
  kind: typeof ComposerStateKinds.OPEN;
  anchor: CommentAnchor;
  /**
   * The chunk whose table or header shows the composer: the anchor's own
   * chunk, a sibling span's, or for a file anchor the header that opened it.
   */
  host: string;
}

export interface SavingComposerState {
  kind: typeof ComposerStateKinds.SAVING;
  anchor: CommentAnchor;
  host: string;
  /** The save in flight; its settle applies only while this is current. */
  token: number;
}

/** A carried draft waits for its new home: the next row pick places it. */
export interface ReanchoringComposerState {
  kind: typeof ComposerStateKinds.REANCHORING;
  draftId: string;
}

/** Where a composer shows: the anchor it writes to, under the host showing it. */
export interface ComposerPlace {
  anchor: CommentAnchor;
  host: string;
}

export type ComposerState =
  | ClosedComposerState
  | OpenComposerState
  | SavingComposerState
  | ReanchoringComposerState;
