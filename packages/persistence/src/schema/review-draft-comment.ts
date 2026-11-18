// `review_draft_comment`: an unposted review comment. Keeps the file
// coordinate, and a line range when `kind` is line: that is the GitHub POST
// payload and what `remapRanges` consumes at carry-over. `anchor_status` is
// NULL while the anchor still holds exactly.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  AnchorStatuses,
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
  type AnchorStatus,
  type CommentAnchorKind,
  type DiffSide,
  type DraftCommentStatus,
} from "types/comments";
import type { ReviewSessionId } from "../types";
import { isNullOrOneOf, isOneOf } from "./checks";
import { stampColumns, tenantColumns } from "./columns";
import { reviewSession } from "./review-session";

const DRAFT_COMMENT_STATUSES = Object.values(DraftCommentStatuses);
const COMMENT_ANCHOR_KINDS = Object.values(CommentAnchorKinds);
const DIFF_SIDES = Object.values(DiffSides);
const ANCHOR_STATUSES = Object.values(AnchorStatuses);

export const reviewDraftComment = pgTable(
  "review_draft_comment",
  {
    ...tenantColumns(),
    reviewSessionId: bigint("review_session_id", { mode: "bigint" })
      .$type<ReviewSessionId>()
      .notNull()
      .references(() => reviewSession.id, { onDelete: "cascade" }),
    /** Canonical within the Brief's artifact; not rename-stable. */
    filePath: text("file_path").notNull(),
    kind: text("kind")
      .$type<CommentAnchorKind>()
      .notNull()
      .default(CommentAnchorKinds.LINE),
    side: text("side").$type<DiffSide>(),
    /** Non-null only when the range genuinely crosses sides (GitHub `start_side`). */
    startSide: text("start_side").$type<DiffSide>(),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    body: text("body").notNull(),
    status: text("status")
      .$type<DraftCommentStatus>()
      .notNull()
      .default(DraftCommentStatuses.DRAFT),
    /** Carry-over verdict on the coordinates; NULL = the anchor still holds. */
    anchorStatus: text("anchor_status").$type<AnchorStatus>(),
    /** The session this row was copied from at carry-over materialization. */
    carriedFromSessionId: bigint("carried_from_session_id", { mode: "bigint" })
      .$type<ReviewSessionId>()
      .references(() => reviewSession.id, { onDelete: "set null" }),
    /**
     * The row this one was copied from: how a write naming the id a
     * pre-materialization read handed out reaches this copy. No FK: the source
     * may be erased, and the id is never reissued.
     */
    carriedFromCommentId: bigint("carried_from_comment_id", {
      mode: "bigint",
    }),
    /** The publish attempt holding this draft; set with its time or not at all. */
    publishClaim: uuid("publish_claim"),
    publishClaimedAt: timestamp("publish_claimed_at", { withTimezone: true }),
    ...stampColumns(),
  },
  (table) => {
    const startSideKnown = isOneOf(table.startSide, DIFF_SIDES);
    const lineAnchored = isOneOf(table.kind, [CommentAnchorKinds.LINE]);
    const fileAnchored = isOneOf(table.kind, [CommentAnchorKinds.FILE]);

    return [
      index("review_draft_comment_session_idx").on(table.reviewSessionId),
      index("review_draft_comment_carried_from_session_idx")
        .on(table.carriedFromSessionId)
        .where(sql`${table.carriedFromSessionId} is not null`),
      check(
        "review_draft_comment_status_check",
        isOneOf(table.status, DRAFT_COMMENT_STATUSES),
      ),
      check(
        "review_draft_comment_kind_check",
        isOneOf(table.kind, COMMENT_ANCHOR_KINDS),
      ),
      check("review_draft_comment_side_check", isOneOf(table.side, DIFF_SIDES)),
      check(
        "review_draft_comment_start_side_check",
        sql`${table.startSide} is null or (${startSideKnown} and ${table.startSide} <> ${table.side})`,
      ),
      check(
        "review_draft_comment_anchor_status_check",
        isNullOrOneOf(table.anchorStatus, ANCHOR_STATUSES),
      ),
      check(
        "review_draft_comment_anchor_shape",
        sql`(${lineAnchored} and ${table.side} is not null and ${table.startLine} is not null and ${table.endLine} is not null and ${table.startLine} > 0 and ${table.endLine} > 0 and (${table.startSide} is not null or ${table.endLine} >= ${table.startLine})) or (${fileAnchored} and ${table.startLine} is null and ${table.endLine} is null and ${table.side} is null and ${table.startSide} is null)`,
      ),
      check(
        "review_draft_comment_publish_claim_pair_check",
        sql`(${table.publishClaim} is null) = (${table.publishClaimedAt} is null)`,
      ),
    ];
  },
);

type DraftCommentSqlRow = typeof reviewDraftComment.$inferSelect;

export interface LineDraftCommentRow extends DraftCommentSqlRow {
  readonly kind: typeof CommentAnchorKinds.LINE;
  readonly side: DiffSide;
  readonly startLine: number;
  readonly endLine: number;
}

export interface FileDraftCommentRow extends DraftCommentSqlRow {
  readonly kind: typeof CommentAnchorKinds.FILE;
  readonly side: null;
  readonly startSide: null;
  readonly startLine: null;
  readonly endLine: null;
}

export function isLineDraftCommentRow(
  row: DraftCommentSqlRow,
): row is LineDraftCommentRow {
  return (
    row.kind === CommentAnchorKinds.LINE &&
    row.side !== null &&
    row.startLine !== null &&
    row.endLine !== null
  );
}

export function isFileDraftCommentRow(
  row: DraftCommentSqlRow,
): row is FileDraftCommentRow {
  return (
    row.kind === CommentAnchorKinds.FILE &&
    row.side === null &&
    row.startSide === null &&
    row.startLine === null &&
    row.endLine === null
  );
}
