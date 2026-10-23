// The `sweep-sessions` task: deletes expired `auth_session` rows, then dead
// grants and month-old dead API tokens, on graphile's cron, and revokes every
// deleted grant's token at GitHub. Instance-wide, not ctx-bound: a credential
// holds no installation. The api already refuses an expired session or a dead
// token, so the sweep is housekeeping and always on.
import type { GitHubOAuthApp } from "github";
import {
  sweepDeadCredentials,
  sweepExpiredSessions,
  type AppDatabase,
  type KeyProvider,
  type OrphanedGrant,
} from "persistence";
import type { Logger } from "logging";
import {
  REVOKE_BUDGET_MS,
  revokeSweptGrantsAtGitHub,
} from "./revoke-at-github";

export const SWEEP_SESSIONS_TASK = "sweep-sessions";

/**
 * Hourly, off the hour and away from the audit sweep's minute. No backfill: a
 * worker down for a day sweeps once on return.
 */
export const SWEEP_SESSIONS_CRONTAB = `41 * * * * ${SWEEP_SESSIONS_TASK}`;

export interface SweepSessionsTaskDeps {
  readonly handle: AppDatabase;
  readonly keyProvider: KeyProvider;
  readonly oauthApp: GitHubOAuthApp;
  readonly log: Logger;
  /** Defaults to `REVOKE_BUDGET_MS`; a test shortens it. */
  readonly revokeBudgetMs?: number;
}

/**
 * Graphile's `Task` shape; the cron payload is unused. Every batch a sweep
 * committed is revoked at GitHub even when a later batch throws: the grants
 * are gone either way, and the failure rethrows once the revokes ran.
 */
export function createSweepSessionsTask(
  deps: SweepSessionsTaskDeps,
): () => Promise<void> {
  const revokeDeps = {
    ...deps,
    revokeBudgetMs: deps.revokeBudgetMs ?? REVOKE_BUDGET_MS,
  };

  return async function sweepSessions(): Promise<void> {
    const now = new Date();
    const orphaned: OrphanedGrant[] = [];
    function collectOrphaned(grants: readonly OrphanedGrant[]): void {
      orphaned.push(...grants);
    }
    let sessionsDeleted = 0;
    let tokensDeleted = 0;
    let grantsOrphaned = 0;

    try {
      sessionsDeleted = await sweepExpiredSessions(
        deps.handle,
        now,
        collectOrphaned,
      );
      tokensDeleted = await sweepDeadCredentials(
        deps.handle,
        now,
        collectOrphaned,
      );
    } finally {
      const unique = collectUniqueGrants(orphaned);
      grantsOrphaned = unique.length;
      await revokeSweptGrantsAtGitHub(revokeDeps, unique);
    }

    const changedCount = sessionsDeleted + tokensDeleted + grantsOrphaned;
    if (changedCount > 0) {
      deps.log.info(
        `sweep-sessions: ${sessionsDeleted} expired sessions and ${tokensDeleted} tokens deleted, ${grantsOrphaned} grants orphaned`,
      );
    }
  };
}

/** A grant its session left that the credential sweep then deleted comes back twice. */
function collectUniqueGrants(
  grants: readonly OrphanedGrant[],
): OrphanedGrant[] {
  const byId = new Map(grants.map((grant) => [grant.id, grant]));
  return [...byId.values()];
}
