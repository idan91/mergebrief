// The Attention List — a projection of rows the session read already returns,
// never a table and never an operation of its own.
//
// Three kinds only. Everything else carries silently: `moved` anchors,
// uncarried read marks, undescended reclassifications. A kind is
// listed here because the reviewer has to act, and `clearedBy` names the
// operations that do it — a LIST, because two of the three clear by either of
// two operations and a scalar would put a CLI back into guessing which.
//
// ONE derivation over both sides of materialization: a session's own rows and
// the in-memory verdicts differ only in whether the subject has a row id yet.
import {
  AnchorStatus,
  DispositionCarryStatus,
  DispositionEvidenceStatus,
  DraftCommentStatus,
  type DispositionDecision,
} from "persistence";
import type { ValueOf } from "types";
import {
  PRODUCT_ACTION_ID,
  type ProductActionId,
} from "../../../../product-operations/ids";

/**
 * The displayed kind. `MISSING_EVIDENCE` is the persistence vocabulary's own
 * token rather than a new name: at materialization a dangling evidence
 * pointer is cleared, which leaves exactly the condition the submit list
 * already names, and `carryStatus` is what distinguishes carried from fresh.
 */
export const ATTENTION_ITEM_KIND = {
  ORPHANED_ANCHOR: "orphaned-anchor",
  REOPENED_DISPOSITION: "reopened-disposition",
  MISSING_EVIDENCE: DispositionEvidenceStatus.MISSING_EVIDENCE,
} as const;
export type AttentionItemKind = ValueOf<typeof ATTENTION_ITEM_KIND>;

export const ATTENTION_SUBJECT_TYPE = {
  DRAFT_COMMENT: "draft-comment",
  DISPOSITION: "disposition",
} as const;
export type AttentionSubjectType = ValueOf<typeof ATTENTION_SUBJECT_TYPE>;

/** At least one operation — an item nothing can clear is not an item. */
type ClearedBy = readonly [ProductActionId, ...ProductActionId[]];

const CLEARED_BY = {
  [ATTENTION_ITEM_KIND.ORPHANED_ANCHOR]: [
    PRODUCT_ACTION_ID.REANCHOR_DRAFT_COMMENT,
    PRODUCT_ACTION_ID.DELETE_DRAFT_COMMENT,
  ],
  [ATTENTION_ITEM_KIND.REOPENED_DISPOSITION]: [
    PRODUCT_ACTION_ID.ADDRESS_RISK,
    PRODUCT_ACTION_ID.DISMISS_RISK,
  ],
  [ATTENTION_ITEM_KIND.MISSING_EVIDENCE]: [
    PRODUCT_ACTION_ID.ADDRESS_RISK,
    PRODUCT_ACTION_ID.DISMISS_RISK,
  ],
} as const satisfies Record<AttentionItemKind, ClearedBy>;

export interface AttentionSubject {
  readonly type: AttentionSubjectType;
  /**
   * A draft comment always names one — the previous session's row until this
   * one writes. `null` only for a disposition, addressed by its anchor.
   */
  readonly id: string | null;
}

export interface AttentionLocation {
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface AttentionItem {
  readonly kind: AttentionItemKind;
  readonly subject: AttentionSubject;
  readonly location: AttentionLocation;
  readonly clearedBy: ClearedBy;
}

/**
 * A draft comment as the projection reads it — a row, or a carried verdict.
 * Both name a row: a carried one names the previous session's, which is what
 * makes the item's `clearedBy` operations addressable before materialization.
 */
export interface AttentionDraftComment {
  readonly id: bigint;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly status: DraftCommentStatus;
  readonly anchorStatus: AnchorStatus | null;
}

export interface AttentionDisposition {
  readonly id?: bigint;
  readonly filePath: string;
  readonly regionStart: number;
  readonly regionEnd: number;
  readonly decision: DispositionDecision;
  readonly carryStatus: DispositionCarryStatus | null;
  readonly evidenceStatus: DispositionEvidenceStatus | null;
}

export interface AttentionInput {
  readonly draftComments: readonly AttentionDraftComment[];
  readonly dispositions: readonly AttentionDisposition[];
}

function item(
  kind: AttentionItemKind,
  type: AttentionSubjectType,
  id: bigint | undefined,
  location: AttentionLocation,
): AttentionItem {
  return {
    kind,
    subject: { type, id: id === undefined ? null : String(id) },
    location,
    clearedBy: CLEARED_BY[kind],
  };
}

/** A disposition's kind, or `undefined` when it carried silently. */
function classifyDisposition(
  row: AttentionDisposition,
): AttentionItemKind | undefined {
  // Reopened wins over missing evidence on the same row: a re-look re-decides
  // the flag outright, so a second item would ask for the same act twice.
  if (row.carryStatus === DispositionCarryStatus.REOPENED) {
    return ATTENTION_ITEM_KIND.REOPENED_DISPOSITION;
  }
  // SETTLED alone: a decision that carried and still stands. A DROPPED row's
  // flag stopped firing, so `address-risk`/`dismiss-risk` have nothing to act
  // on and the item could never be cleared.
  if (
    row.carryStatus === DispositionCarryStatus.SETTLED &&
    row.evidenceStatus === DispositionEvidenceStatus.MISSING_EVIDENCE
  ) {
    return ATTENTION_ITEM_KIND.MISSING_EVIDENCE;
  }
  return undefined;
}

export function deriveAttentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const comment of input.draftComments) {
    if (
      comment.status !== DraftCommentStatus.DRAFT ||
      comment.anchorStatus !== AnchorStatus.ORPHANED
    ) {
      continue;
    }
    items.push(
      item(
        ATTENTION_ITEM_KIND.ORPHANED_ANCHOR,
        ATTENTION_SUBJECT_TYPE.DRAFT_COMMENT,
        comment.id,
        {
          filePath: comment.filePath,
          startLine: comment.startLine,
          endLine: comment.endLine,
        },
      ),
    );
  }
  for (const row of input.dispositions) {
    const kind = classifyDisposition(row);
    if (kind === undefined) continue;
    items.push(
      item(kind, ATTENTION_SUBJECT_TYPE.DISPOSITION, row.id, {
        filePath: row.filePath,
        startLine: row.regionStart,
        endLine: row.regionEnd,
      }),
    );
  }
  return items;
}
