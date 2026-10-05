// `review_session`: one reviewer's private work on one Brief. The Brief is
// the key, so a new Brief (push or retarget) is a new session; there is no
// `pull_request_id` column because the Brief already carries it and the
// erasure cascade reaches `pull_request` through it.
//
// No `submit_note` (the submit wire carries the body) and no `granted_scope`
// (a human and their agent share this row; scope lives on the credential).
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { BriefRowId, ReviewSessionId, ReviewerId } from "../types";
import { ReviewOutcomes, type ReviewOutcome } from "types/reviews";
import { brief } from "./brief";
import { tenantColumns } from "./columns";

export const reviewSession = pgTable(
  "review_session",
  {
    ...tenantColumns<ReviewSessionId>(),
    briefId: bigint("brief_id", { mode: "bigint" })
      .$type<BriefRowId>()
      .notNull()
      .references(() => brief.id, { onDelete: "cascade" }),
    reviewerId: bigint("reviewer_id", { mode: "bigint" })
      .$type<ReviewerId>()
      .notNull(),
    /** Provisional submit verdict; CHECK-constrained in lockstep. */
    reviewOutcome: text("review_outcome")
      .$type<ReviewOutcome>()
      .notNull()
      .default(ReviewOutcomes.COMMENT),
    /**
     * How much of the previous session's work this one materialized with.
     * Stamped ONCE, inside the materialization transaction, because it is the
     * receipt's count: every other way of deriving it reads markers the
     * reviewer's own later work mutates, so the number would shrink as they
     * cleared items and the carry-over row would vanish mid-session.
     * 0 is a first-ever session, or a previous one that carried nothing.
     */
    carriedItemCount: integer("carried_item_count").notNull().default(0),
    begunAt: timestamp("begun_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("review_session_natural_key")
      .on(table.installationId, table.briefId, table.reviewerId)
      .nullsNotDistinct(),
    // The Inbox's per-viewer review state, one probe per brief.
    index("review_session_reviewer_brief_idx").on(
      table.reviewerId,
      table.briefId,
    ),
  ],
);
