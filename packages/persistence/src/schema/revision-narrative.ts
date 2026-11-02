// `revision_narrative`: lean shared explanation of the prevHead→head span.
// `prev_head_sha` is the THIRD SHA role: the prior briefed head, neither
// Brief base nor Checkpoint baseline. The `brief_id` FK CASCADE is the
// anchoring rule: the narrative points into brief-local Change-group ids, so
// a regenerated Brief cascades the old narrative away.
import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import type { BriefRowId, PullRequestRowId } from "../types";
import { artifactColumns, bodyVersionColumn, tenantColumns } from "./columns";
import { brief } from "./brief";
import { pullRequest } from "./pull-request";

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
    /** Prior briefed head, the third SHA role. */
    prevHeadSha: text("prev_head_sha").notNull(),
    headSha: text("head_sha").notNull(),
    /** The body is the span's no-change record, stamped at write from its `artifactKind`. */
    unchanged: boolean("unchanged").notNull().default(false),
    /** The body is the span's skip record, stamped at write from its `artifactKind`. */
    skipped: boolean("skipped").notNull().default(false),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    bodyVersion: bodyVersionColumn(),
    ...artifactColumns(),
  },
  (table) => [
    unique("revision_narrative_natural_key")
      .on(
        table.installationId,
        table.pullRequestId,
        table.prevHeadSha,
        table.headSha,
      )
      .nullsNotDistinct(),
    index("revision_narrative_pull_request_idx").on(table.pullRequestId),
    index("revision_narrative_brief_idx").on(table.briefId),
  ],
);
