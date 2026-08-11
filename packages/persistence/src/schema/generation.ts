// `generation` — mutable status projection of a worker job. NOT a queue, NOT
// a lock, NOT a domain entity: graphile-worker deletes succeeded jobs, so the
// web tier polls this instead. The unique key is NULLS NOT DISTINCT because
// `baseline_sha` is null for briefs — without it Postgres would treat every
// brief row as distinct and the single-row-per-key upsert could never
// conflict.
import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type {
  GenerationFailureCode,
  GenerationFailureParams,
  GenerationKind,
  GenerationPhase,
  GenerationStatus,
  PullRequestRowId,
} from "../types";
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
     * after acquisition — BEFORE generation — so failed and superseded runs
     * still show their outcomes. The policy snapshot lives on the brief
     * artifact, not here.
     */
    repoConfig: text("repo_config"),
    attempts: integer("attempts").notNull().default(0),
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
  ],
);
