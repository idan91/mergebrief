// `checkpoint` — a reviewer's position on a PR (D7). Webhook-driven
// (`pull_request_review`), never an in-app write in M1. One row per
// (reviewer, PR); `last_submitted_sha` advances on submit, never on view.
import { bigint, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { PullRequestRowId, ReviewerId } from "../types.js";
import { tenantColumns } from "./columns.js";
import { pullRequest } from "./pull-request.js";

export const checkpoint = pgTable(
  "checkpoint",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    reviewerId: bigint("reviewer_id", { mode: "bigint" }).$type<ReviewerId>().notNull(),
    /** Purgeable display label (D1). */
    reviewerLogin: text("reviewer_login"),
    /** = the Delta's `baseline_sha`; advances on submit, never on view. */
    lastSubmittedSha: text("last_submitted_sha").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("checkpoint_natural_key").on(
      table.installationId,
      table.pullRequestId,
      table.reviewerId,
    ),
  ],
);
