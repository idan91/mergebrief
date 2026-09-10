// `review_draft_comment`: an unposted review comment. Keeps the file
// coordinate, and a line range when `kind` is line: that is the GitHub POST
// payload and what `remapRanges` consumes at carry-over. `anchor_status` is
// NULL while the anchor still holds exactly.
import { bigint, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { CommentAnchorKinds, type CommentAnchorKind } from "types";
import {
  DraftCommentStatuses,
  type AnchorStatus,
  type DraftCommentSide,
  type DraftCommentStatus,
  type ReviewSessionId,
} from "../types";
import { stampColumns, tenantColumns } from "./columns";
import { reviewSession } from "./review-session";

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
    side: text("side").$type<DraftCommentSide>(),
    /** Non-null only when the range genuinely crosses sides (GitHub `start_side`). */
    startSide: text("start_side").$type<DraftCommentSide>(),
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
    ...stampColumns(),
  },
  (table) => [
    index("review_draft_comment_session_idx").on(table.reviewSessionId),
  ],
);

type DraftCommentSqlRow = typeof reviewDraftComment.$inferSelect;

export interface LineDraftCommentRow extends DraftCommentSqlRow {
  readonly kind: typeof CommentAnchorKinds.LINE;
  readonly side: DraftCommentSide;
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
