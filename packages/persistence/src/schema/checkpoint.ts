// `checkpoint`: a reviewer's position on a PR. Webhook-driven
// (`pull_request_review`), never an in-app write. One row per
// (reviewer, PR); `last_submitted_sha` advances on submit, never on view.
import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { PullRequestRowId, ReviewerId } from "../types";
import { tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const checkpoint = pgTable(
  "checkpoint",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    reviewerId: bigint("reviewer_id", { mode: "bigint" })
      .$type<ReviewerId>()
      .notNull(),
    /** Purgeable display label. */
    reviewerLogin: text("reviewer_login"),
    /** = the Delta's `baseline_sha`; advances on submit, never on view. */
    lastSubmittedSha: text("last_submitted_sha").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("checkpoint_natural_key")
      .on(table.installationId, table.pullRequestId, table.reviewerId)
      .nullsNotDistinct(),
    index("checkpoint_pull_request_idx").on(table.pullRequestId),
  ],
);
