// `delta`: the shared, reviewer-agnostic delta core. Its lower bound is
// `baseline_sha` = a reviewer's Checkpoint SHA, NOT the PR base. Deliberately
// NO `reviewer_id`: the per-reviewer layer is a separate overlay boundary.
import { bigint, index, pgTable, text, unique } from "drizzle-orm/pg-core";
import type { PullRequestRowId } from "../types";
import { artifactColumns, bodyVersionColumn, tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const delta = pgTable(
  "delta",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    /** Checkpoint baseline: a prior head at last submit. */
    baselineSha: text("baseline_sha").notNull(),
    headSha: text("head_sha").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    bodyVersion: bodyVersionColumn(),
    ...artifactColumns(),
  },
  (table) => [
    unique("delta_natural_key")
      .on(
        table.installationId,
        table.pullRequestId,
        table.baselineSha,
        table.headSha,
      )
      .nullsNotDistinct(),
    index("delta_pull_request_idx").on(table.pullRequestId),
  ],
);
