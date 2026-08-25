// `pull_request` — the mutable aggregate root. Parent of every immutable
// per-PR artifact; the retention/cascade anchor. The partial index on
// `purge_after` (the sweep target) is raw SQL in the hardening migration.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  PullRequestSources,
  type PullRequestSource,
  type PrState,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../types";
import { tenantColumns } from "./columns";

export const pullRequest = pgTable(
  "pull_request",
  {
    ...tenantColumns<PullRequestRowId>(),
    /**
     * The owning GitHub user for a url-box row; NULL for App-installation
     * rows. Exactly one of `installation_id`/`owner_user_id` is set — the
     * `pull_request_owner_shape` CHECK (raw SQL migration) pairs each with
     * its `source` value.
     */
    ownerUserId: bigint("owner_user_id", {
      mode: "bigint",
    }).$type<ReviewerId>(),
    /** Which door created the row; CHECK-paired with the scope columns. */
    source: text("source")
      .$type<PullRequestSource>()
      .notNull()
      .default(PullRequestSources.APP_INSTALLATION),
    repoId: bigint("repo_id", { mode: "bigint" }).$type<RepoId>().notNull(),
    prNumber: integer("pr_number").notNull(),
    /** Purgeable display label, refreshed on webhook. */
    repoSlug: text("repo_slug"),
    /**
     * PR title — same purgeable-display-label class as `repo_slug`, refreshed
     * on every webhook. Nullable: rows ingested before the column existed
     * backfill on their next event.
     */
    title: text("title"),
    /**
     * The PR-base SHA from the last `pull_request` event: PR-meta's span lower
     * bound regardless of brief existence. Nullable: rows ingested before the
     * column backfill on their next event; `pull_request_review` events don't
     * carry it and never overwrite a stored value.
     */
    baseSha: text("base_sha"),
    /**
     * Whether the PR is a GitHub draft, from the last `pull_request` event —
     * the FE derives own-draft author affordances from it. Rows ingested by an
     * event that doesn't carry it take the default and are corrected on the
     * PR's next `pull_request` event, same refresh pattern as `title`.
     */
    draft: boolean("draft").notNull().default(false),
    /**
     * The PR author's GitHub login, refreshed on every `pull_request` event.
     * Purgeable display-label class like `title`/`repo_slug`, but NEVER
     * exposed to the FE — it is server-side input to the per-request
     * `viewerIsAuthor` derivation only. Nullable: rows missing it backfill on
     * the next `pull_request` event.
     */
    authorLogin: text("author_login"),
    state: text("state").$type<PrState>().notNull(),
    /**
     * The branded Entry comment id. Nullable: the delete+repost flow self-heals
     * a dangling id. A GitHub comment id — plain `bigint`, not branded.
     */
    entryCommentId: bigint("entry_comment_id", { mode: "bigint" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Nullable: null while open or when retention is "never". */
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("pull_request_natural_key").on(
      table.installationId,
      table.repoId,
      table.prNumber,
    ),
    // Owner-world natural key: partial, so the two worlds keep independent
    // rows for the same (repo, number). Owner upserts conflict-target THIS
    // index (`targetWhere` must match its predicate).
    uniqueIndex("pull_request_owner_natural_key")
      .on(table.ownerUserId, table.repoId, table.prNumber)
      .where(sql`${table.installationId} is null`),
  ],
);
