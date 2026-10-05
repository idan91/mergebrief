// The scope QUERY seam: which ROWS a bound identity sees. Two worlds exist,
// the App-installation tenant (`installation_id`) and the url-box owner
// (`pull_request.owner_user_id`, children marked by a NULL `installation_id`).
// Every ctx-bound factory resolves its ctx into a `RowScope` ONCE and routes
// every read filter, write stamp, and parent check through it, so a query can
// never mix worlds. The context shapes live in `scope-context.ts`. NOT
// exported from `index.ts`: a caller outside this package holds a context,
// never a `RowScope`.
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { pullRequest } from "../schema/pull-request";
import { isOwnerContext, type ScopeContext } from "./scope-context";
import type { InstallationId, ReviewerId } from "../types";
import {
  PullRequestSources,
  type PullRequestSource,
} from "types/pull-requests";

export interface RowScope {
  readonly ctx: ScopeContext;
  /** Child-insert stamp: the tenant id, or NULL in the owner world. */
  readonly installationId: InstallationId | null;
  /** `pull_request`-insert owner stamp: NULL in the installation world. */
  readonly ownerUserId: ReviewerId | null;
  /** The `source` this scope stamps on `pull_request` and audit rows. */
  readonly source: PullRequestSource;
  /** For error messages: `tenant <id>` / `owner <id>`. */
  readonly label: string;
  /** Predicate selecting THIS scope's `pull_request` rows. */
  matchesPullRequest(): SQL;
  /**
   * Predicate for a child table's rows: the world mark on the child's own
   * `installation_id` column, plus, in the owner world, a `pull_request`
   * semi-join on the child's `pull_request_id` for owner isolation.
   */
  matchesChild(
    installationIdColumn: AnyPgColumn,
    pullRequestIdColumn: AnyPgColumn,
  ): SQL;
  /**
   * World-mark-only predicate, for rows already resolved through an in-scope
   * anchor (the Review Session graph). Isolation within the owner world rides
   * that anchor.
   */
  matchesWorld(installationIdColumn: AnyPgColumn): SQL;
}

function definedSql(condition: SQL | undefined): SQL {
  if (condition === undefined) {
    throw new Error("scope predicate composed to undefined");
  }
  return condition;
}

/**
 * The url-box world: rows the owner pasted. Owner-world child rows carry no
 * owner column of their own: a NULL `installation_id` marks the world, and
 * owner ISOLATION rides the `pull_request` parent through the `matchesChild`
 * semi-join, mirroring the defense-in-depth the installation world gets from
 * the child's own tenant column.
 */
function resolveOwnerScope(ownerUserId: ReviewerId): RowScope {
  return {
    ctx: { ownerUserId },
    installationId: null,
    ownerUserId,
    source: PullRequestSources.URL,
    label: `owner ${ownerUserId}`,
    matchesPullRequest() {
      return definedSql(
        and(
          isNull(pullRequest.installationId),
          eq(pullRequest.ownerUserId, ownerUserId),
        ),
      );
    },
    matchesChild(installationIdColumn, pullRequestIdColumn) {
      return definedSql(
        and(
          isNull(installationIdColumn),
          sql`${pullRequestIdColumn} in (
              select ${pullRequest.id} from ${pullRequest}
              where ${pullRequest.ownerUserId} = ${ownerUserId}
                and ${pullRequest.installationId} is null
            )`,
        ),
      );
    },
    matchesWorld(installationIdColumn) {
      return isNull(installationIdColumn);
    },
  };
}

/**
 * The App-installation world: every table carries the tenant id itself, so
 * one column comparison is the whole predicate at every level.
 */
function resolveTenantScope(installationId: InstallationId): RowScope {
  return {
    ctx: { installationId },
    installationId,
    ownerUserId: null,
    source: PullRequestSources.INSTALLATION,
    label: `tenant ${installationId}`,
    matchesPullRequest() {
      return eq(pullRequest.installationId, installationId);
    },
    matchesChild(installationIdColumn) {
      return eq(installationIdColumn, installationId);
    },
    matchesWorld(installationIdColumn) {
      return eq(installationIdColumn, installationId);
    },
  };
}

/** Resolve a ctx into the one `RowScope` every store method routes through. */
export function resolveScope(ctx: ScopeContext): RowScope {
  return isOwnerContext(ctx)
    ? resolveOwnerScope(ctx.ownerUserId)
    : resolveTenantScope(ctx.installationId);
}
