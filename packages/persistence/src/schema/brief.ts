// `brief` — immutable span artifact keyed by BOTH endpoints (D3):
// `(installation_id, pull_request_id, base_sha, head_sha)`. `base_sha` is
// the PR-base role — distinct name from Delta's `baseline_sha` (checkpoint)
// by design. Provenance columns surface on the Receipt (D6); `head_index` +
// `commit_count` back ADR 0012's display label (`index + head8`).
import { bigint, integer, pgTable, text, unique } from "drizzle-orm/pg-core";
import type { BriefRowId, PullRequestRowId } from "../types";
import { artifactColumns, tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const brief = pgTable(
  "brief",
  {
    ...tenantColumns<BriefRowId>(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    /** PR-base SHA — the whole-PR span's lower bound (D3). */
    baseSha: text("base_sha").notNull(),
    headSha: text("head_sha").notNull(),
    /** Per-distinct-head display index (ADR 0012 label, D3). */
    headIndex: integer("head_index").notNull(),
    /** Commit count for display (`commitRange`, D4 — no commit-list snapshot). */
    commitCount: integer("commit_count").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    /**
     * Repo-config provenance + generation-time policy snapshot (ADR 0032 #8/
     * #11): JSON — per-file `path + blob SHA + outcome` table, collision
     * disclosures, and the fired custom-attribute definitions + de-emphasis
     * rules in effect (the FE renders display weight from THIS snapshot,
     * never live policy). Nullable: rows predating BRIEF-52.
     */
    repoConfig: text("repo_config"),
    ...artifactColumns(),
  },
  (table) => [
    unique("brief_natural_key").on(
      table.installationId,
      table.pullRequestId,
      table.baseSha,
      table.headSha,
    ),
  ],
);
