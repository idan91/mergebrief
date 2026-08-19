// `review_session` — one reviewer's private work on one Brief. The Brief is
// the key, so a new Brief (push or retarget) is a new session; there is no
// `pull_request_id` column because the Brief already carries it and the
// erasure cascade reaches `pull_request` through it.
//
// No `submit_note` (the submit wire carries the body) and no `granted_scope`
// (a human and their agent share this row; scope lives on the credential).
import { bigint, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { BriefRowId, ReviewSessionId, ReviewerId } from "../types";
import { ReviewOutcome } from "../types";
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
      .default(ReviewOutcome.COMMENT),
    begunAt: timestamp("begun_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("review_session_natural_key").on(
      table.installationId,
      table.briefId,
      table.reviewerId,
    ),
  ],
);
