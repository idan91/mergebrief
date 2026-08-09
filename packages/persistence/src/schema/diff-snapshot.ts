// `diff_snapshot` — the config-gated baseline snapshot (D4): the persisted
// `base→checkpoint` diff, written only at submit. The ONE persisted-code
// exception to "no raw code in the DB". `sha` is a checkpoint SHA. No
// origin columns — a fetched diff, not LLM output (D6).
import { bigint, pgTable, text, unique } from "drizzle-orm/pg-core";
import type { PullRequestRowId } from "../types";
import { artifactColumns, tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const diffSnapshot = pgTable(
  "diff_snapshot",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    /** A checkpoint SHA (D4). */
    sha: text("sha").notNull(),
    ...artifactColumns(),
  },
  (table) => [
    unique("diff_snapshot_natural_key").on(
      table.installationId,
      table.pullRequestId,
      table.sha,
    ),
  ],
);
