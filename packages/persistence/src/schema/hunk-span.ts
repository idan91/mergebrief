// `hunk_span`, the durable carry-over hop: the `@@` headers between the
// previous Brief's head and this one, kept so an anchor can be remapped long
// after the diff that moved it is gone. Same natural-key family as
// `comparison_marks`, and coordinates-only in the same way: never line
// content, so it is NOT code-bearing. A sibling table rather than a
// `comparison_marks` column because marks store added and removed ranges
// unpaired, and a remap needs both sides of each header paired.
import { bigint, index, pgTable, text, unique } from "drizzle-orm/pg-core";
import type { PullRequestRowId } from "../types";
import { stampColumns, tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const hunkSpan = pgTable(
  "hunk_span",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    /** The previous Brief's head, the hop's lower bound. */
    baselineSha: text("baseline_sha").notNull(),
    headSha: text("head_sha").notNull(),
    /** JSON `[{file, hunks:[{oldStart, oldLines, newStart, newLines}]}]`. */
    spans: text("spans").notNull(),
    ...stampColumns(),
  },
  (table) => [
    unique("hunk_span_natural_key")
      .on(
        table.installationId,
        table.pullRequestId,
        table.baselineSha,
        table.headSha,
      )
      .nullsNotDistinct(),
    index("hunk_span_pull_request_idx").on(table.pullRequestId),
  ],
);
