// `pull_request` — the mutable aggregate root (D5). Parent of every
// immutable per-PR artifact; the retention/cascade anchor. No `activated_at`
// (dropped 2026-07-04, ADR 0020). The partial index on `purge_after`
// (sweep target) is raw SQL in the hardening migration.
import { bigint, boolean, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { PrState, PullRequestRowId, RepoId } from "../types";
import { tenantColumns } from "./columns";

export const pullRequest = pgTable(
  "pull_request",
  {
    ...tenantColumns<PullRequestRowId>(),
    repoId: bigint("repo_id", { mode: "bigint" }).$type<RepoId>().notNull(),
    prNumber: integer("pr_number").notNull(),
    /** Purgeable display label (D1), refreshed on webhook. */
    repoSlug: text("repo_slug"),
    /**
     * PR title — same purgeable-display-label class as `repo_slug` (D5 as
     * amended for BRIEF-19), refreshed on every webhook. Nullable: rows
     * ingested before the column existed backfill on their next event.
     */
    title: text("title"),
    /**
     * The PR-base SHA from the last `pull_request` event (BRIEF-19 follow-up,
     * agreed 2026-07-06): PR-meta's span lower bound regardless of brief
     * existence. Nullable: rows ingested before the column backfill on their
     * next event; `pull_request_review` events don't carry it and never
     * overwrite a stored value.
     */
    baseSha: text("base_sha"),
    /**
     * Whether the PR is a GitHub draft, from the last `pull_request` event
     * (BRIEF-43): the FE derives own-draft author affordances from it. NOT
     * NULL, defaults false — rows ingested by an event that doesn't carry it
     * (e.g. `pull_request_review`) take the default and are corrected on the
     * PR's next `pull_request` event, same refresh pattern as `title`.
     */
    draft: boolean("draft").notNull().default(false),
    /**
     * The PR author's GitHub login (BRIEF-43), refreshed on every
     * `pull_request` event. Purgeable display-label class like `title`/
     * `repo_slug`, but NEVER exposed to the FE — it is server-side input to the
     * per-request `viewerIsAuthor` derivation only. Nullable: rows ingested
     * before the column existed (or via an event that omits it, or a deleted
     * author) backfill on the next `pull_request` event.
     */
    authorLogin: text("author_login"),
    state: text("state").$type<PrState>().notNull(),
    /**
     * The branded Entry comment id (D5). Nullable: no writer in BRIEF-2, and
     * the delete+repost flow (ADR 0016 #3) self-heals a dangling id. It is a
     * GitHub comment id — a plain `bigint`, no branded CommentId type.
     */
    entryCommentId: bigint("entry_comment_id", { mode: "bigint" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Nullable: null while open or when retention is "never" (D5). */
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("pull_request_natural_key").on(table.installationId, table.repoId, table.prNumber),
  ],
);
