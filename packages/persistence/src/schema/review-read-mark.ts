// `review_read_mark` — one Chunk the reviewer has marked read. Presence is
// the mark; there is no unread row.
import { bigint, pgTable, text, unique } from "drizzle-orm/pg-core";
import type { ReviewSessionId } from "../types";
import { stampColumns, tenantColumns } from "./columns";
import { reviewSession } from "./review-session";

export const reviewReadMark = pgTable(
  "review_read_mark",
  {
    ...tenantColumns(),
    reviewSessionId: bigint("review_session_id", { mode: "bigint" })
      .$type<ReviewSessionId>()
      .notNull()
      .references(() => reviewSession.id, { onDelete: "cascade" }),
    /** Brief-local Chunk id. */
    chunkId: text("chunk_id").notNull(),
    ...stampColumns(),
  },
  (table) => [
    unique("review_read_mark_natural_key").on(
      table.reviewSessionId,
      table.chunkId,
    ),
  ],
);
