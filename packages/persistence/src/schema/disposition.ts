// `disposition` — an anchored reviewer decision on a risk-surface flag
// (D7). Table ships in M1; ROWS are written in M2 (engagement write-side).
// Anchored by content coordinates (file/attribute/region/sha), never a
// brief-local id — those dangle on regeneration. M1 shape covers only
// region-anchored flags (region NOT NULL); playbook-item dispositions
// (nullable region + flag_kind) are deferred to M2.
import { bigint, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { DispositionDecision, PullRequestRowId, ReviewerId } from "../types";
import { tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const disposition = pgTable(
  "disposition",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    reviewerId: bigint("reviewer_id", { mode: "bigint" }).$type<ReviewerId>().notNull(),
    /** Canonical within an artifact; rename-stable id is M2. */
    filePath: text("file_path").notNull(),
    /** The risk-surface attribute token — the Flag's identity. */
    attribute: text("attribute").notNull(),
    regionStart: integer("region_start").notNull(),
    regionEnd: integer("region_end").notNull(),
    /** SHA the region coordinates are anchored at. */
    decidedAtSha: text("decided_at_sha").notNull(),
    decision: text("decision").$type<DispositionDecision>().notNull(),
    /** Dismissal reason, verbatim on the Receipt; null if addressed. */
    reason: text("reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("disposition_natural_key").on(
      table.installationId,
      table.pullRequestId,
      table.reviewerId,
      table.filePath,
      table.attribute,
      table.regionStart,
      table.regionEnd,
      table.decidedAtSha,
    ),
  ],
);
