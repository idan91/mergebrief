// `comparison_marks`: the mechanical changed-line sidecar per comparison span.
// Coordinates-only, never line content, so NOT code-bearing. Reviewer-agnostic:
// `baseline_sha` may be a prevHead OR a checkpoint SHA; the marks are a pure
// function of the pair.
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import type { PullRequestRowId } from "../types";
import { isJsonObject } from "./checks";
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
    /**
     * The base each head's PR diff was read against: the refs the span text
     * was computed from. Never written over a narrative or delta computed
     * from other bases, so the row certifies what is stored beside it.
     */
    prevBaseSha: text("prev_base_sha").notNull(),
    newBaseSha: text("new_base_sha").notNull(),
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
    index("comparison_marks_pull_request_idx").on(table.pullRequestId),
    check("comparison_marks_body_check", isJsonObject(table.body)),
  ],
);
