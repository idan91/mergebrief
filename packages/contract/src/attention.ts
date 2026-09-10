// The Attention List's wire shapes: what a session read hands a client, and
// the operations that clear each item. The derivation over session rows stays
// in the API.
//
// `clearedBy` is a LIST because two of the three kinds clear by either of two
// operations, and a scalar would put a CLI back into guessing which.
import type { DispositionEvidenceStatus, CommentAnchorKind } from "persistence";
import type { ValueOf } from "types";
import type { ProductActionId } from "./operations";

/**
 * The displayed kind. `MISSING_EVIDENCE` is the persistence vocabulary's own
 * token rather than a new name: at materialization a dangling evidence
 * pointer is cleared, which leaves exactly the condition the submit list
 * already names, and `carryStatus` is what distinguishes carried from fresh.
 */
export const AttentionItemKinds = {
  ORPHANED_ANCHOR: "orphaned-anchor",
  REOPENED_DISPOSITION: "reopened-disposition",
  MISSING_EVIDENCE: "missing-evidence",
} as const satisfies Record<string, string> & {
  readonly MISSING_EVIDENCE: DispositionEvidenceStatus;
};
export type AttentionItemKind = ValueOf<typeof AttentionItemKinds>;

export const AttentionSubjectTypes = {
  DRAFT_COMMENT: "draft-comment",
  DISPOSITION: "disposition",
} as const;
export type AttentionSubjectType = ValueOf<typeof AttentionSubjectTypes>;

/** At least one operation: an item nothing can clear is not an item. */
export type ClearedBy = readonly [ProductActionId, ...ProductActionId[]];

export interface AttentionSubject {
  readonly type: AttentionSubjectType;
  /**
   * A draft comment always names one, the previous session's row until this
   * one writes. `null` only for a disposition, addressed by its anchor.
   */
  readonly id: string | null;
  /**
   * The flag's attribute, on a disposition only. It is the one part of that
   * anchor `location` does not carry, and without it two flags on one region
   * make two items nothing can tell apart, let alone act on.
   */
  readonly attribute: string | null;
}

export interface AttentionLocationBase {
  readonly kind: CommentAnchorKind;
  readonly filePath: string;
}

export interface LineAttentionLocation extends AttentionLocationBase {
  readonly kind: Extract<CommentAnchorKind, "line">;
  readonly startLine: number;
  readonly endLine: number;
}

export interface FileAttentionLocation extends AttentionLocationBase {
  readonly kind: Extract<CommentAnchorKind, "file">;
}

export type AttentionLocation = LineAttentionLocation | FileAttentionLocation;

export interface AttentionItem {
  readonly kind: AttentionItemKind;
  readonly subject: AttentionSubject;
  readonly location: AttentionLocation;
  readonly clearedBy: ClearedBy;
}
