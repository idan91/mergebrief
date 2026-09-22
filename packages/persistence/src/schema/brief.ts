// `brief`: the immutable span artifact keyed by BOTH endpoints,
// `(installation_id, pull_request_id, base_sha, head_sha)`. `base_sha` is
// the PR-base role, a distinct name from Delta's `baseline_sha` (checkpoint)
// by design.
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
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
    baseSha: text("base_sha").notNull(),
    headSha: text("head_sha").notNull(),
    /** Per-distinct-head display index; with commit_count it backs the label. */
    headIndex: integer("head_index").notNull(),
    commitCount: integer("commit_count").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    /**
     * Repo-config origin and policy snapshot, JSON; the FE renders display
     * weight from THIS snapshot, never live policy. Null before the feature.
     */
    repoConfig: text("repo_config"),
    /** 'anchored' | 'fresh-restart' | 'none', CHECK-constrained; null before the feature. */
    anchorState: text("anchor_state"),
    /** Non-null exactly when `anchor_state = 'fresh-restart'` (CHECK). */
    anchorReason: text("anchor_reason"),
    /**
     * JSON `string[]` of chunk ids carried from the previous Brief, which is
     * what makes a read mark carry with no line math; null before the column.
     */
    carriedChunkIds: text("carried_chunk_ids"),
    /**
     * JSON `string[]` of every group id this chain has used, so a retired id
     * is never re-minted; null before the column, healed by the next run.
     */
    usedGroupIds: text("used_group_ids"),
    ...artifactColumns(),
  },
  (table) => [
    unique("brief_natural_key")
      .on(
        table.installationId,
        table.pullRequestId,
        table.baseSha,
        table.headSha,
      )
      .nullsNotDistinct(),
    // The Inbox's latest brief per pull request, and its generated-at sort.
    index("brief_pull_request_created_idx").on(
      table.pullRequestId,
      table.createdAt.desc(),
    ),
  ],
);
