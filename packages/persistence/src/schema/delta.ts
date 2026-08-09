// `delta` — the shared, reviewer-agnostic delta core (D3/D6/D8). Lower
// bound is `baseline_sha` = a reviewer's Checkpoint SHA (NOT the PR base —
// D3's SHA-role separation). Deliberately NO `reviewer_id`: the per-reviewer
// layer is the M2 `delta_overlay` boundary (D8).
import { bigint, pgTable, text, unique } from "drizzle-orm/pg-core";
import type { PullRequestRowId } from "../types";
import { artifactColumns, tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const delta = pgTable(
  "delta",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    /** Checkpoint baseline — a prior head at last submit (D3). */
    baselineSha: text("baseline_sha").notNull(),
    headSha: text("head_sha").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    ...artifactColumns(),
  },
  (table) => [
    unique("delta_natural_key").on(
      table.installationId,
      table.pullRequestId,
      table.baselineSha,
      table.headSha,
    ),
  ],
);
