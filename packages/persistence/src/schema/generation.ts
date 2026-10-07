// `generation` is the mutable status projection of a worker job. NOT a queue,
// NOT a domain entity: graphile-worker deletes succeeded jobs, so the web tier
// polls this instead. A run claims the row with `run_id` under a lease that
// lapses at `lease_expires_at`. The unique key is NULLS NOT DISTINCT because
// `baseline_sha` is null for briefs; without it Postgres would treat every
// brief row as distinct and the single-row-per-key upsert could never
// conflict.
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { GenerationKind, PullRequestRowId } from "../types";
import type {
  GenerationFailureCode,
  GenerationFailureParams,
  GenerationPhase,
  GenerationStatus,
} from "types/generations";
import { tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

export const generation = pgTable(
  "generation",
  {
    ...tenantColumns(),
    pullRequestId: bigint("pull_request_id", { mode: "bigint" })
      .$type<PullRequestRowId>()
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    kind: text("kind").$type<GenerationKind>().notNull(),
    headSha: text("head_sha").notNull(),
    /** Null for brief; checkpoint SHA for delta. */
    baselineSha: text("baseline_sha"),
    status: text("status").$type<GenerationStatus>().notNull(),
    /** Optional determinate-progress detail. */
    phase: text("phase").$type<GenerationPhase>(),
    /** Failure vocabulary code when failed (CHECK-constrained). */
    errorCode: text("error_code").$type<GenerationFailureCode>(),
    /** Interpolation params for the code's template; `detail` pre-sanitized. */
    errorParams: jsonb("error_params").$type<GenerationFailureParams>(),
    /**
     * Repo-config per-file origin: JSON `{files, collisions}` written right
     * after acquisition, BEFORE generation, so failed and superseded runs
     * still show their outcomes. The policy snapshot lives on the brief
     * artifact, not here.
     */
    repoConfig: text("repo_config"),
    attempts: integer("attempts").notNull().default(0),
    /** The claim holder's run; null while nobody holds the row. */
    runId: uuid("run_id"),
    /** The claim lapses at this database time unless its holder renews it. */
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("generation_natural_key")
      .on(
        table.installationId,
        table.pullRequestId,
        table.kind,
        table.headSha,
        table.baselineSha,
      )
      .nullsNotDistinct(),
    index("generation_pull_request_created_at_idx").on(
      table.pullRequestId,
      table.createdAt,
    ),
    // The daily cap's count runs under the instance-wide start lock; this
    // keeps that locked section an index scan over the day's rows.
    index("generation_created_at_idx").on(table.createdAt),
  ],
);
