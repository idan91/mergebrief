// `inbox_archive`: a reviewer put a pull request out of their own Inbox.
// One row per (reviewer, PR), anchored on the latest brief's head at the
// time: a brief at a new head lifts the archive by predicate, so a stale
// row is harmless and nothing sweeps it. A brief at the same head, a
// retarget, does not.
import { bigint, index, pgTable, text, unique } from "drizzle-orm/pg-core";
import type { PullRequestRowId, ReviewerId } from "../types";
import { stampColumns, tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const inboxArchive = pgTable(
  "inbox_archive",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    reviewerId: bigint("reviewer_id", { mode: "bigint" })
      .$type<ReviewerId>()
      .notNull(),
    /** The latest brief's head when archived; NULL when no brief existed yet. */
    headSha: text("head_sha"),
    ...stampColumns(),
  },
  (table) => [
    unique("inbox_archive_natural_key")
      .on(table.installationId, table.pullRequestId, table.reviewerId)
      .nullsNotDistinct(),
    // The inbox probe and the pull request cascade seek by these two alone.
    index("inbox_archive_pull_request_reviewer_idx").on(
      table.pullRequestId,
      table.reviewerId,
    ),
  ],
);
