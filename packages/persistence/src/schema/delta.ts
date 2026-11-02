// `delta`: the shared, reviewer-agnostic delta core. Its lower bound is
// `baseline_sha` = a reviewer's Checkpoint SHA, NOT the PR base. Deliberately
// NO `reviewer_id`: the per-reviewer layer is a separate overlay boundary.
import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
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
    /** The body is the span's skip record, stamped at write from its `artifactKind`. */
    skipped: boolean("skipped").notNull().default(false),
    /** The body is the span's no-change record, stamped at write from its `artifactKind`. */
    unchanged: boolean("unchanged").notNull().default(false),
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
