// `comparison_marks` — mechanical changed-line sidecar per comparison span.
// Coordinates-only, never line content — NOT code-bearing, so no
// `persist_baseline_snapshot` gate. Reviewer-agnostic by construction:
// `baseline_sha` may be a prevHead OR a checkpoint SHA; the marks are a pure
// function of the pair.
import { bigint, pgTable, text, unique } from "drizzle-orm/pg-core";
import type { PullRequestRowId } from "../types";
import { artifactColumns, tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const comparisonMarks = pgTable(
  "comparison_marks",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    /** Span lower bound: a prevHead OR a checkpoint SHA. */
    baselineSha: text("baseline_sha").notNull(),
    headSha: text("head_sha").notNull(),
    ...artifactColumns(),
  },
  (table) => [
    unique("comparison_marks_natural_key")
      .on(
        table.installationId,
        table.pullRequestId,
        table.baselineSha,
        table.headSha,
      )
      .nullsNotDistinct(),
  ],
);
