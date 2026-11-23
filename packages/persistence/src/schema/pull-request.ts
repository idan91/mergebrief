// `pull_request` is the mutable aggregate root and the retention anchor: the
// worker's sweep deletes a row by `closed_at` once the operator's window has
// passed, and the children go by FK cascade.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
  PrStates,
  PullRequestSources,
  type PrState,
  type PullRequestSource,
} from "types/pull-requests";
import { differsFrom, isOneOf } from "./checks";
import { tenantColumns } from "./columns";

const PR_STATES = Object.values(PrStates);

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
     * GitHub's `pull_request.created_at`, the Inbox's created sort key. Null
     * until an event or a live read carries it: a row stored before the
     * column existed fills in the next time GitHub names it.
     */
    githubCreatedAt: timestamp("github_created_at", { withTimezone: true }),
    /**
     * The live read: when GitHub last answered for this row and the head it
     * reported, which a newer push webhook clears, and, for a url row, when
     * GitHub first stopped showing it to the owner. Null before the first
     * read; an installation row is never marked unreachable.
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
    /**
     * The collaborator who first approved generation for a PR whose author
     * needs approval, and when. Set once, never moved; CHECK-paired.
     */
    triggerApprovedBy: bigint("trigger_approved_by", {
      mode: "bigint",
    }).$type<ReviewerId>(),
    triggerApprovedAt: timestamp("trigger_approved_at", {
      withTimezone: true,
    }),
    /**
     * The pusher who turned on generating on every push, and when: while set,
     * trigger conditions never hold a push of this PR. CHECK-paired.
     */
    generateEveryPushBy: bigint("generate_every_push_by", {
      mode: "bigint",
    }).$type<ReviewerId>(),
    generateEveryPushAt: timestamp("generate_every_push_at", {
      withTimezone: true,
    }),
    /**
     * When the PR first met `reviewRequested`: a person's review request or
     * review. Set once, never cleared; the condition stays met while set.
     */
    reviewRequestedMetAt: timestamp("review_requested_met_at", {
      withTimezone: true,
    }),
    /**
     * When a changed path first matched the repo's `paths` globs, and the
     * digest of those globs: met while the digest matches the current list.
     * CHECK-paired.
     */
    pathsMetAt: timestamp("paths_met_at", { withTimezone: true }),
    pathsMetDigest: text("paths_met_digest"),
    /** NULL while open; the retention sweep's one input once closed. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /**
     * Bumped by every update, so a reader can tell whether the row changed
     * since it loaded it: a live read takes a stored GitHub time as its own
     * only while this still holds the value the read was planned against.
     */
    rowVersion: integer("row_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    const notOpen = differsFrom(table.state, PrStates.OPEN);
    const installationSourced = isOneOf(table.source, [
      PullRequestSources.INSTALLATION,
    ]);
    const urlSourced = isOneOf(table.source, [PullRequestSources.URL]);

    return [
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
      // Partial: the retention sweep deletes by a closed_at range, and an open
      // row never qualifies.
      index("pull_request_closed_at_idx")
        .on(table.closedAt)
        .where(sql`${table.closedAt} is not null`),
      check("pull_request_state_check", isOneOf(table.state, PR_STATES)),
      check(
        "pull_request_open_retention_shape",
        sql`${notOpen} or ${table.closedAt} is null`,
      ),
      check(
        "pull_request_trigger_approval_shape",
        sql`(${table.triggerApprovedBy} is null) = (${table.triggerApprovedAt} is null)`,
      ),
      check(
        "pull_request_generate_every_push_shape",
        sql`(${table.generateEveryPushBy} is null) = (${table.generateEveryPushAt} is null)`,
      ),
      check(
        "pull_request_paths_met_shape",
        sql`(${table.pathsMetAt} is null) = (${table.pathsMetDigest} is null)`,
      ),
      check(
        "pull_request_owner_shape",
        sql`(${installationSourced} and ${table.installationId} is not null and ${table.ownerUserId} is null) or (${urlSourced} and ${table.installationId} is null and ${table.ownerUserId} is not null)`,
      ),
    ];
  },
);
