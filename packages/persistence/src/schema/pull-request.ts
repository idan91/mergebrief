// `pull_request` — the mutable aggregate root (D5). Parent of every
// immutable per-PR artifact; the retention/cascade anchor. No `activated_at`
// (dropped 2026-07-04, ADR 0020). The partial index on `purge_after`
// (sweep target) is raw SQL in the hardening migration.
import { bigint, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
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
    state: text("state").$type<PrState>().notNull(),
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
