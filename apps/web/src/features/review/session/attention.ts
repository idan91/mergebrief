// The Attention List as it arrives on the wire: the three carried kinds, the
// subject each one addresses, and the operations that clear it.
//
// `clearedBy` is read, never inferred: the server sends the operations that
// clear an item precisely so no client has to keep a kind-to-action table of
// its own, and a client that guesses drifts the moment a kind gains one.
import type { AttentionItemKind, AttentionSubjectType } from "contract";
import type { CommentAnchorKinds } from "types";

import type { UnknownValue } from "@web/utils/open-enum/types";

export interface SessionLineAttentionLocation {
  kind: typeof CommentAnchorKinds.LINE;
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface SessionFileAttentionLocation {
  kind: typeof CommentAnchorKinds.FILE;
  filePath: string;
}

/** A location kind this bundle predates; its item renders nothing. */
export interface SessionHeldAttentionLocation {
  kind: UnknownValue;
  filePath: string;
}

export type SessionAttentionLocation =
  | SessionLineAttentionLocation
  | SessionFileAttentionLocation
  | SessionHeldAttentionLocation;

export interface SessionAttentionItem {
  kind: AttentionItemKind | UnknownValue;
  subject: {
    type: AttentionSubjectType | UnknownValue;
    /** A draft comment always names its row; absent on a disposition. */
    id?: string;
    /** The flag's attribute, on a disposition only. */
    attribute?: string;
  };
  location: SessionAttentionLocation;
  /** Non-empty: an item nothing can clear is not an item. */
  clearedBy: string[];
}
