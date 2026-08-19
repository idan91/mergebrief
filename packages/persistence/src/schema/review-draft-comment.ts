// `review_draft_comment` — an unposted review comment. Keeps the
// file-and-line coordinate whatever else changes: it is the GitHub POST
// payload and what `remapRanges` consumes at carry-over. `anchor_status` is
// NULL while the anchor still holds exactly.
import { bigint, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import type { AnchorStatus, DraftCommentSide, ReviewSessionId } from "../types";
import { DraftCommentStatus } from "../types";
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
    side: text("side").$type<DraftCommentSide>().notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    body: text("body").notNull(),
    status: text("status")
      .$type<DraftCommentStatus>()
      .notNull()
      .default(DraftCommentStatus.DRAFT),
    /** Carry-over verdict on the coordinates; NULL = the anchor still holds. */
    anchorStatus: text("anchor_status").$type<AnchorStatus>(),
    /** The session this row was copied from at carry-over materialization. */
    carriedFromSessionId: bigint("carried_from_session_id", { mode: "bigint" })
      .$type<ReviewSessionId>()
      .references(() => reviewSession.id, { onDelete: "set null" }),
    ...stampColumns(),
  },
  (table) => [
    index("review_draft_comment_session_idx").on(table.reviewSessionId),
  ],
);
