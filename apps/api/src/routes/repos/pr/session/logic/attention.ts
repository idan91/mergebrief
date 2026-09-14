// The Attention List, a projection of rows the session read already returns,
// never a table and never an operation of its own.
//
// Three kinds only: everything else carries silently. A kind is listed here
// because the reviewer has to act on it.
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
  type DraftAnchor,
  type DraftCommentStatus,
} from "persistence";
import { CommentAnchorKinds } from "types/comments";
import {
  AttentionItemKinds,
  AttentionSubjectTypes,
  ProductActionIds,
  type AttentionItem,
  type AttentionItemKind,
  type AttentionLocation,
  type AttentionSubject,
  type ClearedBy,
} from "contract";

const CLEARED_BY_KIND = {
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

/**
 * A draft comment as the projection reads it, a row, or a carried verdict.
 * Both name a row: a carried one names the previous session's, which is what
 * makes the item's `clearedBy` operations addressable before materialization.
 */
export interface AttentionDraftComment {
  readonly id: bigint;
  readonly anchor: DraftAnchor;
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
  return { kind, subject, location, clearedBy: CLEARED_BY_KIND[kind] };
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

function deriveDraftLocation(
  comment: AttentionDraftComment,
): AttentionLocation {
  const { anchor } = comment;
  if (anchor.kind === CommentAnchorKinds.FILE) {
    return {
      kind: CommentAnchorKinds.FILE,
      filePath: anchor.file,
    };
  }
  return {
    kind: CommentAnchorKinds.LINE,
    filePath: anchor.file,
    startLine: anchor.startLine,
    endLine: anchor.endLine,
  };
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
        deriveDraftLocation(comment),
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
          kind: CommentAnchorKinds.LINE,
          filePath: row.filePath,
          startLine: row.regionStart,
          endLine: row.regionEnd,
        },
      ),
    );
  }
  return items;
}
