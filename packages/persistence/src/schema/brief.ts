// `brief`: the immutable span artifact keyed by BOTH endpoints,
// `(installation_id, pull_request_id, base_sha, head_sha)`. `base_sha` is
// the PR-base role, a distinct name from Delta's `baseline_sha` (checkpoint)
// by design.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { BriefRowId, PullRequestRowId } from "../types";
import { AnchorStates, FreshRestartReasons } from "types/generations";
import { isDistinctFrom, isNullOrOneOf, isOneOf } from "./checks";
import { artifactColumns, bodyVersionColumn, tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

const ANCHOR_STATES = Object.values(AnchorStates);

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
    /** The Nth brief on this PR, retargets included; the `rev` a link names. */
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
    bodyVersion: bodyVersionColumn(),
    /**
     * The body's Chunk, change-group and risk-flag counts, the most rows of
     * each a review session may hold. Written together with the body, all
     * NULL when it cannot be read or was written before the columns.
     */
    sessionChunkCount: integer("session_chunk_count"),
    sessionGroupCount: integer("session_group_count"),
    sessionFlagCount: integer("session_flag_count"),
    ...artifactColumns(),
  },
  (table) => {
    const freshRestart = isOneOf(table.anchorState, [
      AnchorStates.FRESH_RESTART,
    ]);
    const modelSwap = isOneOf(table.anchorReason, [
      FreshRestartReasons.MODEL_SWAP,
    ]);
    const notFreshRestart = isDistinctFrom(
      table.anchorState,
      AnchorStates.FRESH_RESTART,
    );

    return [
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
      // A rev addresses one brief: two runs racing for the same index fail
      // loudly instead of leaving a link ambiguous.
      uniqueIndex("brief_pull_request_head_index_key").on(
        table.pullRequestId,
        table.headIndex,
      ),
      check(
        "brief_anchor_state_check",
        isNullOrOneOf(table.anchorState, ANCHOR_STATES),
      ),
      check(
        "brief_anchor_reason_shape",
        sql`(${freshRestart} and ${modelSwap}) or (${notFreshRestart} and ${table.anchorReason} is null)`,
      ),
    ];
  },
);
