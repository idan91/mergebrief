// `pull_request` is the mutable aggregate root and the retention anchor. The
// partial index on `purge_after` is raw SQL in the hardening migration.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { PullRequestRowId, RepoId, ReviewerId } from "../types";
import {
  PullRequestSources,
  type PrState,
  type PullRequestSource,
} from "types/pull-requests";
import { tenantColumns } from "./columns";

export const pullRequest = pgTable(
  "pull_request",
  {
    ...tenantColumns<PullRequestRowId>(),
    /**
     * The owning user for a url-box row; NULL for App-installation rows. The
     * `pull_request_owner_shape` CHECK pairs exactly one with `source`.
     */
    ownerUserId: bigint("owner_user_id", {
      mode: "bigint",
    }).$type<ReviewerId>(),
    /** Which door created the row; CHECK-paired with the scope columns. */
    source: text("source")
      .$type<PullRequestSource>()
      .notNull()
      .default(PullRequestSources.INSTALLATION),
    repoId: bigint("repo_id", { mode: "bigint" }).$type<RepoId>().notNull(),
    prNumber: integer("pr_number").notNull(),
    /** Purgeable display label, refreshed on webhook. */
    repoSlug: text("repo_slug"),
    /** Purgeable display label like `repo_slug`; backfills on the next event. */
    title: text("title"),
    /**
     * The PR-base SHA from the last `pull_request` event. Review events carry
     * none and never overwrite a stored value.
     */
    baseSha: text("base_sha"),
    /** From the last `pull_request` event; events without it keep the stored value. */
    draft: boolean("draft").notNull().default(false),
    /**
     * NEVER exposed to the FE: server-side input to `viewerIsAuthor` only.
     * Purgeable like `title`; backfills on the next `pull_request` event.
     */
    authorLogin: text("author_login"),
    state: text("state").$type<PrState>().notNull(),
    /** Nullable: the delete+repost flow self-heals a dangling id. */
    entryCommentId: bigint("entry_comment_id", { mode: "bigint" }),
    /**
     * GitHub's `pull_request.updated_at` from the last event applied. The
     * ingest upsert applies an event only when its value is not older than
     * this one, so a late delivery cannot roll the row back.
     */
    githubUpdatedAt: timestamp("github_updated_at", { withTimezone: true }),
    /**
     * The live read, for url rows only: when GitHub last answered for this
     * row, the head it reported, and when it first stopped showing the row
     * to the owner. All null for installation rows and before the first read.
     */
    githubReadAt: timestamp("github_read_at", { withTimezone: true }),
    githubHeadSha: text("github_head_sha"),
    githubUnreachableAt: timestamp("github_unreachable_at", {
      withTimezone: true,
    }),
    /**
     * The last stack GitHub resolved for this PR and when. Only a non-null
     * resolve overwrites: once every neighbour merges the live read sees
     * none, and the stored one is the history the brief shows.
     */
    stack: jsonb("stack").$type<unknown>(),
    stackReadAt: timestamp("stack_read_at", { withTimezone: true }),
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
    // Partial so the two worlds keep independent rows for one (repo, number);
    // owner upserts conflict-target this index and must match its predicate.
    uniqueIndex("pull_request_owner_natural_key")
      .on(table.ownerUserId, table.repoId, table.prNumber)
      .where(sql`${table.installationId} is null`),
    // The daily cap counts across scope worlds by repo_id alone.
    index("pull_request_repo_idx").on(table.repoId),
  ],
);
