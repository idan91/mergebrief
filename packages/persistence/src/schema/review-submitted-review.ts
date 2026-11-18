// `review_submitted_review` — the id of a GitHub review already submitted
// from this session. The own-comment join key for conversation
// reconciliation, and the record that stops a double post.
import { bigint, pgTable, unique } from "drizzle-orm/pg-core";
import type { ReviewSessionId } from "../types";
import { stampColumns, tenantColumns } from "./columns";
import { reviewSession } from "./review-session";

export const reviewSubmittedReview = pgTable(
  "review_submitted_review",
  {
    ...tenantColumns(),
    reviewSessionId: bigint("review_session_id", { mode: "bigint" })
      .$type<ReviewSessionId>()
      .notNull()
      .references(() => reviewSession.id, { onDelete: "cascade" }),
    /** GitHub review id. */
    githubReviewId: bigint("github_review_id", { mode: "bigint" }).notNull(),
    ...stampColumns(),
  },
  (table) => [
    unique("review_submitted_review_natural_key").on(
      table.reviewSessionId,
      table.githubReviewId,
    ),
  ],
);
