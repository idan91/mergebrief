// `revision_narrative` — lean shared explanation of the prevHead→head span
// (D12, ADR 0024). `prev_head_sha` is the THIRD SHA role (prior briefed
// head — neither Brief base nor Checkpoint baseline). `brief_id` FK CASCADE
// is the anchoring rule: the narrative points into brief-local Change-group
// IDs, so a regenerated Brief cascades the old narrative away.
import { bigint, pgTable, text, unique } from "drizzle-orm/pg-core";
import type { BriefRowId, PullRequestRowId } from "../types.js";
import { artifactColumns, tenantColumns } from "./columns.js";
import { brief } from "./brief.js";
import { pullRequest } from "./pull-request.js";

export const revisionNarrative = pgTable(
  "revision_narrative",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    briefId: bigint("brief_id", { mode: "bigint" })
      .$type<BriefRowId>()
      .notNull()
      .references(() => brief.id, { onDelete: "cascade" }),
    /** Prior briefed head — the third SHA role (D12). */
    prevHeadSha: text("prev_head_sha").notNull(),
    headSha: text("head_sha").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    ...artifactColumns(),
  },
  (table) => [
    unique("revision_narrative_natural_key").on(
      table.installationId,
      table.pullRequestId,
      table.prevHeadSha,
      table.headSha,
    ),
  ],
);
