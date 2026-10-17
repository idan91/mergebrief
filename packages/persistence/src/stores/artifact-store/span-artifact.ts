// The one reader and writer for the span artifact tables (`brief`, `delta`,
// `revision_narrative`, `comparison_marks`, `hunk_span`): rows keyed by
// `(installation_id, pull_request_id, <lower sha>, head_sha)` under a
// `pull_request`. Tenancy lives here and nowhere else: a read filters through
// the scope, a write stamps the scope and verifies the parent in the same
// transaction. A per-table store names its table, its lower-bound column and
// the columns a read or write carries; it reaches the rows no other way.
import { and, eq, getTableName, type SQL } from "drizzle-orm";
import type {
  AnyPgColumn,
  PgColumn,
  PgInsertValue,
  PgSelect,
  PgTable,
  PgUpdateSetSource,
} from "drizzle-orm/pg-core";
import type { AppDrizzle } from "../../db/handle";
import { pullRequest } from "../../schema/pull-request";
import type { InstallationId, PullRequestRowId } from "../../types";
import { type RowScope, ScopeViolationError } from "../scope";

export type Tx = Parameters<Parameters<AppDrizzle["transaction"]>[0]>[0];

/** The columns every span artifact table carries under the same name. */
export interface SpanArtifactColumns {
  readonly installationId: AnyPgColumn<{ data: InstallationId }>;
  readonly pullRequestId: AnyPgColumn<{ data: PullRequestRowId }>;
  readonly headSha: AnyPgColumn<{ data: string }>;
}

export type SpanArtifactTable = PgTable & SpanArtifactColumns;

/** The columns the access stamps itself; a caller's conflict `set` never names them. */
const STAMPED_COLUMNS = ["installationId", "pullRequestId"] as const;

/** The natural key minus the scope stamp. */
export interface SpanKey {
  readonly pullRequestId: PullRequestRowId;
  /** The span's lower bound: `base_sha`, `baseline_sha` or `prev_head_sha`. */
  readonly lowerSha: string;
  readonly headSha: string;
}

export interface SpanArtifactWrite<TTable extends SpanArtifactTable> {
  /** The parent the row hangs off; resolved in scope before the insert. */
  readonly pullRequestId: PullRequestRowId;
  /** Insert values, natural-key SHAs included; the scope stamp and parent are the access's. */
  readonly values: PgInsertValue<TTable>;
  /** What a rewrite of the same span replaces; never the stamped columns. */
  readonly set: PgUpdateSetSource<TTable>;
  /** A further in-scope anchor check, after the parent check, same transaction. */
  assertAnchorInScope?(tx: Tx): Promise<void>;
}

export type SpanOrder = PgColumn | SQL;

/** The row shape a `select` yields. */
export type SelectedRow<TQuery extends PgSelect> =
  TQuery["_"]["result"][number];

/**
 * A `select` names the columns only: an unfiltered
 * `db.select(...).from(table).$dynamic()` over the access's own table. The
 * scope filter is applied here, last, so it replaces any `where` a caller set.
 */
export interface SpanArtifactAccess<TTable extends SpanArtifactTable> {
  /** Upserts on the natural key; a foreign parent throws `ScopeViolationError` before any insert. */
  write(write: SpanArtifactWrite<TTable>): Promise<TTable["$inferSelect"]>;
  get<TQuery extends PgSelect>(
    key: SpanKey,
    select: TQuery,
  ): Promise<SelectedRow<TQuery> | undefined>;
  list<TQuery extends PgSelect>(
    pullRequestId: PullRequestRowId,
    select: TQuery,
    order?: SpanOrder,
  ): Promise<SelectedRow<TQuery>[]>;
}

function assertSetLeavesStampAlone(set: object): void {
  const stamped = STAMPED_COLUMNS.find((column) => column in set);
  if (stamped !== undefined) {
    throw new Error(`a span artifact rewrite may not set ${stamped}`);
  }
}

function filterSpans<TQuery extends PgSelect>(
  select: TQuery,
  predicate: SQL,
  order: SpanOrder | undefined,
): TQuery {
  const spans = select.where(predicate);
  return order === undefined ? spans : spans.orderBy(order);
}

export function createSpanArtifactAccess<TTable extends SpanArtifactTable>(
  db: AppDrizzle,
  scope: RowScope,
  table: TTable,
  lowerSha: AnyPgColumn<{ data: string }>,
): SpanArtifactAccess<TTable> {
  const naturalKey = [
    table.installationId,
    table.pullRequestId,
    lowerSha,
    table.headSha,
  ];

  function matchesInScope(): SQL {
    return scope.matchesChild(table.installationId, table.pullRequestId);
  }

  function matchesPullRequest(pullRequestId: PullRequestRowId): SQL {
    const inScope = matchesInScope();
    return and(inScope, eq(table.pullRequestId, pullRequestId)) ?? inScope;
  }

  /** One flat `and`: drizzle keeps nested `and()` parentheses, and the SQL text is pinned. */
  function matchesSpan(key: SpanKey): SQL {
    const inScope = matchesInScope();
    const onSpan = and(
      inScope,
      eq(table.pullRequestId, key.pullRequestId),
      eq(lowerSha, key.lowerSha),
      eq(table.headSha, key.headSha),
    );
    return onSpan ?? inScope;
  }

  async function assertParentInScope(
    tx: Tx,
    pullRequestId: PullRequestRowId,
  ): Promise<void> {
    const scopedParent = and(
      scope.matchesPullRequest(),
      eq(pullRequest.id, pullRequestId),
    );
    const rows = await tx
      .select({ id: pullRequest.id })
      .from(pullRequest)
      .where(scopedParent)
      .limit(1);
    if (rows[0] === undefined) {
      throw new ScopeViolationError("pull_request", pullRequestId, scope.label);
    }
  }

  return {
    write(write) {
      assertSetLeavesStampAlone(write.set);

      return db.transaction(async (tx) => {
        await assertParentInScope(tx, write.pullRequestId);
        await write.assertAnchorInScope?.(tx);

        const rows = await tx
          .insert(table)
          .values({
            ...write.values,
            installationId: scope.installationId,
            pullRequestId: write.pullRequestId,
          })
          .onConflictDoUpdate({ target: naturalKey, set: write.set })
          .returning();
        const row = rows[0];
        if (row === undefined) {
          throw new Error(`${getTableName(table)} write returned no row`);
        }
        return row;
      });
    },

    async get(key, select) {
      const rows = await select.where(matchesSpan(key)).limit(1);
      return rows[0];
    },

    list(pullRequestId, select, order) {
      return filterSpans(select, matchesPullRequest(pullRequestId), order);
    },
  };
}
