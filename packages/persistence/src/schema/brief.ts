// `brief` — immutable span artifact keyed by BOTH endpoints:
// `(installation_id, pull_request_id, base_sha, head_sha)`. `base_sha` is
// the PR-base role — a distinct name from Delta's `baseline_sha` (checkpoint)
// by design. `head_index` + `commit_count` back the display label
// (`index + head8`).
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
    /** PR-base SHA — the whole-PR span's lower bound. */
    baseSha: text("base_sha").notNull(),
    headSha: text("head_sha").notNull(),
    /** Per-distinct-head display index, part of the label. */
    headIndex: integer("head_index").notNull(),
    /** Commit count for display — no commit-list snapshot is kept. */
    commitCount: integer("commit_count").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    /**
     * Repo-config origin + generation-time policy snapshot: JSON — per-file
     * `path + blob SHA + outcome` table, collision disclosures, and the
     * custom-attribute definitions + de-emphasis rules in effect. The FE
     * renders display weight from THIS snapshot, never live policy. Nullable:
     * rows predating the feature.
     */
    repoConfig: text("repo_config"),
    /**
     * How this brief relates to its predecessor — 'anchored' |
     * 'fresh-restart' | 'none' (CHECK-constrained). Nullable: rows predating
     * the feature.
     */
    anchorState: text("anchor_state"),
    /**
     * Why an anchored-capable generation restarted fresh ('model-swap');
     * non-null exactly when `anchor_state = 'fresh-restart'` (CHECK).
     */
    anchorReason: text("anchor_reason"),
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
