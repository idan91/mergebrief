// `generation` is the mutable status projection of a worker job. NOT a queue,
// NOT a domain entity: graphile-worker deletes succeeded jobs, so the web tier
// polls this instead. A run claims the row with `run_id` under a lease that
// lapses at `lease_expires_at`. The unique key is NULLS NOT DISTINCT because
// `baseline_sha` is null for briefs; without it Postgres would treat every
// brief row as distinct and the single-row-per-key upsert could never
// conflict.
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
  uuid,
} from "drizzle-orm/pg-core";
import {
  GenerationKinds,
  type GenerationKind,
  type PullRequestRowId,
} from "../types";
import {
  GenerationFailureCodes,
  GenerationPhases,
  GenerationStatuses,
  type GenerationFailureCode,
  type GenerationFailureParams,
  type GenerationPhase,
  type GenerationStatus,
} from "types/generations";
import { isNullOrOneOf, isOneOf } from "./checks";
import { tenantColumns } from "./columns";
import { pullRequest } from "./pull-request";

const GENERATION_KINDS = Object.values(GenerationKinds);
const GENERATION_STATUSES = Object.values(GenerationStatuses);
const GENERATION_PHASES = Object.values(GenerationPhases);
const GENERATION_FAILURE_CODES = Object.values(GenerationFailureCodes);

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
    /** Runs that claimed the row since a trigger last projected it pending. */
    claims: integer("claims").notNull().default(0),
    /** The claim holder's run; null while nobody holds the row. */
    runId: uuid("run_id"),
    /** The claim lapses at this database time unless its holder renews it. */
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    /**
     * A recovery takeover ended owing a retry (a transient failure or a
     * shutdown): the head's next recovery job reruns the row. Any later claim,
     * trigger or row write clears it.
     */
    awaitsRecovery: boolean("awaits_recovery").notNull().default(false),
    /**
     * When a trigger last named this head. Status writes never move it, so
     * it orders a PR's brief rows by the push that asked for them. A row no
     * trigger named yet starts at the epoch, below every triggered one.
     */
    triggeredAt: timestamp("triggered_at", { withTimezone: true })
      .notNull()
      .default(sql`to_timestamp(0)`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    const briefKind = isOneOf(table.kind, [GenerationKinds.BRIEF]);
    const baselinedKind = isOneOf(table.kind, [
      GenerationKinds.DELTA,
      GenerationKinds.REVISION_NARRATIVE,
    ]);

    return [
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
      check("generation_kind_check", isOneOf(table.kind, GENERATION_KINDS)),
      check(
        "generation_status_check",
        isOneOf(table.status, GENERATION_STATUSES),
      ),
      check(
        "generation_phase_check",
        isNullOrOneOf(table.phase, GENERATION_PHASES),
      ),
      check(
        "generation_error_code_check",
        isNullOrOneOf(table.errorCode, GENERATION_FAILURE_CODES),
      ),
      check(
        "generation_kind_baseline_shape",
        sql`(${briefKind} and ${table.baselineSha} is null) or (${baselinedKind} and ${table.baselineSha} is not null)`,
      ),
    ];
  },
);
