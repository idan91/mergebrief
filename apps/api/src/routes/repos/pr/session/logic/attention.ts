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
  AnchorStatuses,
  DispositionCarryStatuses,
  DispositionEvidenceStatuses,
  DraftCommentStatuses,
  type DispositionDecision,
  type AnchorStatus,
  type DispositionCarryStatus,
  type DispositionEvidenceStatus,
  type DraftCommentStatus,
} from "persistence";
import type { ValueOf } from "types";
import {
  ProductActionIds,
  type ProductActionId,
} from "../../../../../product-operations/ids";

/**
 * The displayed kind. `MISSING_EVIDENCE` is the persistence vocabulary's own
 * token rather than a new name: at materialization a dangling evidence
 * pointer is cleared, which leaves exactly the condition the submit list
 * already names, and `carryStatus` is what distinguishes carried from fresh.
 */
export const AttentionItemKinds = {
  ORPHANED_ANCHOR: "orphaned-anchor",
  REOPENED_DISPOSITION: "reopened-disposition",
  MISSING_EVIDENCE: DispositionEvidenceStatuses.MISSING_EVIDENCE,
} as const;
export type AttentionItemKind = ValueOf<typeof AttentionItemKinds>;

export const AttentionSubjectTypes = {
  DRAFT_COMMENT: "draft-comment",
  DISPOSITION: "disposition",
} as const;
export type AttentionSubjectType = ValueOf<typeof AttentionSubjectTypes>;

/** At least one operation — an item nothing can clear is not an item. */
type ClearedBy = readonly [ProductActionId, ...ProductActionId[]];

const ClearedBy = {
  [AttentionItemKinds.ORPHANED_ANCHOR]: [
    ProductActionIds.REANCHOR_DRAFT_COMMENT,
    ProductActionIds.DELETE_DRAFT_COMMENT,
  ],
  [AttentionItemKinds.REOPENED_DISPOSITION]: [
    ProductActionIds.ADDRESS_RISK,
    ProductActionIds.DISMISS_RISK,
  ],
  [AttentionItemKinds.MISSING_EVIDENCE]: [
    ProductActionIds.ADDRESS_RISK,
    ProductActionIds.DISMISS_RISK,
  ],
} as const satisfies Record<AttentionItemKind, ClearedBy>;

export interface AttentionSubject {
  readonly type: AttentionSubjectType;
  /**
   * A draft comment always names one — the previous session's row until this
   * one writes. `null` only for a disposition, addressed by its anchor.
   */
  readonly id: string | null;
  /**
   * The flag's attribute, on a disposition only. It is the one part of that
   * anchor `location` does not carry, and without it two flags on one region
   * make two items nothing can tell apart — let alone act on.
   */
  readonly attribute: string | null;
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
  readonly filePath: string;
  readonly attribute: string;
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
  subject: AttentionSubject,
  location: AttentionLocation,
): AttentionItem {
  return { kind, subject, location, clearedBy: ClearedBy[kind] };
}

/** A disposition's kind, or `undefined` when it carried silently. */
function classifyDisposition(
  row: AttentionDisposition,
): AttentionItemKind | undefined {
  // Reopened wins over missing evidence on the same row: a re-look re-decides
  // the flag outright, so a second item would ask for the same act twice.
  if (row.carryStatus === DispositionCarryStatuses.REOPENED) {
    return AttentionItemKinds.REOPENED_DISPOSITION;
  }
  // SETTLED alone: a decision that carried and still stands. A DROPPED row's
  // flag stopped firing, so `address-risk`/`dismiss-risk` have nothing to act
  // on and the item could never be cleared.
  if (
    row.carryStatus === DispositionCarryStatuses.SETTLED &&
    row.evidenceStatus === DispositionEvidenceStatuses.MISSING_EVIDENCE
  ) {
    return AttentionItemKinds.MISSING_EVIDENCE;
  }
  return undefined;
}

export function deriveAttentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const comment of input.draftComments) {
    if (
      comment.status !== DraftCommentStatuses.DRAFT ||
      comment.anchorStatus !== AnchorStatuses.ORPHANED
    ) {
      continue;
    }
    items.push(
      item(
        AttentionItemKinds.ORPHANED_ANCHOR,
        {
          type: AttentionSubjectTypes.DRAFT_COMMENT,
          id: String(comment.id),
          attribute: null,
        },
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
      // No id, on either side of materialization: every operation that
      // clears a disposition addresses it by its anchor, which is the
      // attribute plus the region `location` states.
      item(
        kind,
        {
          type: AttentionSubjectTypes.DISPOSITION,
          id: null,
          attribute: row.attribute,
        },
        {
          filePath: row.filePath,
          startLine: row.regionStart,
          endLine: row.regionEnd,
        },
      ),
    );
  }
  return items;
}
