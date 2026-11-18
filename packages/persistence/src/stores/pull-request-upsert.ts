// The one `pull_request` upsert and the column builders its writers share.
// Ingest runs it inside its transaction with terminal preservation; the
// tenant repository runs it bare. Both get the `githubUpdatedAt` ordering
// guard whenever the input carries one.
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Mutable } from "types";
import { PrStates, type PrState } from "types/pull-requests";
import type { internal } from "../db/handle";
import { pullRequest } from "../schema/pull-request";
import type { LiveReadStamp } from "./live-read";
import type { RowScope } from "./scope";
import type {
  PullRequestLifecycle,
  PullRequestRow,
  PullRequestUpsertInput,
} from "./tenant";

/**
 * The columns an upsert's conflict branch may name, drizzle's own update
 * shape, so a column may take a value or a SQL expression. Partial by design:
 * a key left off is a column drizzle does not touch, which is how an omitted
 * input field preserves the stored value.
 */
export type PullRequestUpdateSet = PgUpdateSetSource<typeof pullRequest>;

/** The next `row_version`: every update of a row moves it. */
export function buildNextRowVersion(): SQL {
  return sql`${pullRequest.rowVersion} + 1`;
}

/** The three live-read columns a stamp writes; the unreachable mark clears. */
export function buildLiveReadColumns(stamp: LiveReadStamp): {
  githubReadAt: Date;
  githubHeadSha: string;
  githubUnreachableAt: null;
} {
  return {
    githubReadAt: stamp.readAt,
    githubHeadSha: stamp.headSha,
    githubUnreachableAt: null,
  };
}

/**
 * Normalize a lifecycle to explicit column values from the discriminant:
 * OPEN always writes a NULL close time (drizzle skips `undefined`, and a
 * reopened PR must leave the retention sweep), terminal states write theirs.
 */
export function buildLifecycleColumns(lc: PullRequestLifecycle): {
  state: PrState;
  closedAt: Date | null;
} {
  if (lc.state === PrStates.OPEN) {
    return { state: lc.state, closedAt: null };
  }
  return { state: lc.state, closedAt: lc.closedAt };
}

/**
 * SQL predicate (for use in an `ON CONFLICT DO UPDATE`): the EXISTING
 * `pull_request` row is already in a terminal (`closed`/`merged`) state.
 */
function isStoredRowTerminal() {
  return sql`${pullRequest.state} in (${PrStates.CLOSED}, ${PrStates.MERGED})`;
}

/**
 * Builds the per-column chooser the lifecycle columns share: with
 * `preserveTerminal`, a column keeps its STORED value when the existing row is
 * already terminal; without it, the fresh value always wins.
 */
function buildTerminalKeeper(
  preserveTerminal: boolean,
): <T>(stored: PgColumn, fresh: T) => T | SQL {
  if (!preserveTerminal) {
    return (_stored, fresh) => fresh;
  }
  return (stored, fresh) =>
    sql`case when ${isStoredRowTerminal()} then ${stored} else ${fresh} end`;
}

/**
 * The query surface the upsert needs, satisfied by both the unwrapped db and
 * a transaction client, so ingest (inside its tx) and the tenant repository
 * share one upsert.
 */
export type UpsertExecutor = Pick<
  ReturnType<typeof internal>,
  "insert" | "select"
>;

export interface UpsertOutcome {
  readonly row: PullRequestRow;
  /** False when the guard below left the stored row untouched. */
  readonly applied: boolean;
}

/**
 * The one `pull_request` upsert, the scope stamped from its `RowScope`.
 * With `preserveTerminal`, a `state: open` input landing on a closed/merged
 * row keeps the stored terminal lifecycle; non-lifecycle fields refresh
 * either way, with omitted optionals preserving stored values. The row
 * applies only when its `githubUpdatedAt` is not older than the stored one.
 */
export async function upsertPullRequestRow(
  executor: UpsertExecutor,
  scope: RowScope,
  input: PullRequestUpsertInput,
  preserveTerminal: boolean,
): Promise<UpsertOutcome> {
  const guardAt = input.githubUpdatedAt;
  const lifecycle = buildLifecycleColumns(input);
  // The keeper stops an open input resurrecting a terminal row; a terminal
  // input (closed, then merged) always lands, ordering is the guard's job.
  const keepTerminal = buildTerminalKeeper(
    preserveTerminal && input.state === PrStates.OPEN,
  );
  const set: PullRequestUpdateSet = {
    repoSlug: input.repoSlug,
    title: input.title,
    state: keepTerminal(pullRequest.state, lifecycle.state),
    closedAt: keepTerminal(pullRequest.closedAt, lifecycle.closedAt),
    rowVersion: buildNextRowVersion(),
    updatedAt: new Date(),
  };
  // Omitted (review events) preserves the stored value, since an absent key is a
  // column drizzle does not touch.
  if (input.baseSha !== undefined) {
    set.baseSha = input.baseSha;
  }
  if (input.draft !== undefined) {
    set.draft = input.draft;
  }
  if (input.authorLogin !== undefined) {
    set.authorLogin = input.authorLogin;
  }
  if (input.githubUpdatedAt !== undefined) {
    set.githubUpdatedAt = input.githubUpdatedAt;
  }
  if (input.liveRead !== undefined) {
    Object.assign(set, buildLiveReadColumns(input.liveRead));
  }
  const insert = executor.insert(pullRequest).values({
    installationId: scope.installationId,
    ownerUserId: scope.ownerUserId,
    source: scope.source,
    repoId: input.repoId,
    prNumber: input.prNumber,
    repoSlug: input.repoSlug,
    title: input.title,
    baseSha: input.baseSha,
    draft: input.draft,
    authorLogin: input.authorLogin,
    githubUpdatedAt: input.githubUpdatedAt,
    githubReadAt: input.liveRead?.readAt,
    githubHeadSha: input.liveRead?.headSha,
    ...lifecycle,
    updatedAt: new Date(),
  });
  // Each world conflicts on ITS natural key: the tenant unique constraint, or
  // the owner partial index (targetWhere must mirror its predicate).
  const isOwnerWorld = scope.ownerUserId !== null;
  const worldKey = isOwnerWorld
    ? pullRequest.ownerUserId
    : pullRequest.installationId;
  const conflict: Mutable<Parameters<typeof insert.onConflictDoUpdate>[0]> = {
    target: [worldKey, pullRequest.repoId, pullRequest.prNumber],
    set,
  };
  if (isOwnerWorld) {
    conflict.targetWhere = sql`${pullRequest.installationId} is null`;
  }
  if (guardAt !== undefined) {
    conflict.setWhere = sql`${pullRequest.githubUpdatedAt} is null or ${pullRequest.githubUpdatedAt} <= ${guardAt}`;
  }

  const rows = await insert.onConflictDoUpdate(conflict).returning();
  const row = rows[0];
  if (row !== undefined) {
    return { row, applied: true };
  }

  // The guard skipped the update, so nothing returned: read the stored row.
  const scopedNaturalKey = and(
    scope.matchesPullRequest(),
    eq(pullRequest.repoId, input.repoId),
    eq(pullRequest.prNumber, input.prNumber),
  );
  const stored = await executor
    .select()
    .from(pullRequest)
    .where(scopedNaturalKey)
    .limit(1);
  const storedRow = stored[0];
  if (storedRow === undefined) {
    throw new Error("pull_request upsert returned no row");
  }
  return { row: storedRow, applied: false };
}
