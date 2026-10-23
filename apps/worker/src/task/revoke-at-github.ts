// Runs after the sweep's transactions commit, never inside one: a GitHub call
// holds no row lock and no pool connection. Best-effort: the grants are
// already gone and GitHub expires their tokens on its own, so a few revokes
// run at once inside a time budget, and whatever the budget does not reach
// is skipped with one warning rather than holding the worker's job slot.
import {
  deleteUserToken,
  type GitHubOAuthApp,
  type OAuthErrorCode,
} from "github";
import type { Logger } from "logging";
import {
  decryptToken,
  GrantSealedColumns,
  type KeyProvider,
  type OrphanedGrant,
} from "persistence";

const CREDENTIAL_UNREADABLE = "credential-unreadable";
const REVOKE_CONCURRENCY = 3;
/** The whole run's budget; one call past it still ends at the OAuth timeout. */
export const REVOKE_BUDGET_MS = 30_000;

/** The `code` set the `grant.revoke.fail` line documents. */
type RevokeFailureCode = OAuthErrorCode | typeof CREDENTIAL_UNREADABLE;

export interface RevokeAtGitHubDeps {
  readonly keyProvider: KeyProvider;
  readonly oauthApp: GitHubOAuthApp;
  readonly log: Logger;
  readonly revokeBudgetMs: number;
}

/** Revoke each swept grant's access token at GitHub, within the run's budget. */
export async function revokeSweptGrantsAtGitHub(
  deps: RevokeAtGitHubDeps,
  grants: readonly OrphanedGrant[],
): Promise<void> {
  const deadline = Date.now() + deps.revokeBudgetMs;
  const pending = [...grants];
  let skipped = 0;

  async function drainPending(): Promise<void> {
    for (
      let grant = pending.shift();
      grant !== undefined;
      grant = pending.shift()
    ) {
      if (Date.now() >= deadline) {
        skipped += 1;
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- each lane revokes one grant at a time
      await revokeGrantAtGitHub(deps, grant);
    }
  }
  const lanes = Array.from({ length: REVOKE_CONCURRENCY }, () =>
    drainPending(),
  );
  await Promise.all(lanes);

  if (skipped > 0) {
    deps.log.warn(
      `sweep-sessions: GitHub revoke budget spent; ${skipped} swept grants not revoked`,
      { skipped },
    );
  }
}

async function revokeGrantAtGitHub(
  deps: RevokeAtGitHubDeps,
  grant: OrphanedGrant,
): Promise<void> {
  const accessToken = await decryptToken(
    deps.keyProvider,
    grant.keyRef,
    grant.ghTokenCiphertext,
    { grantId: grant.id, column: GrantSealedColumns.ACCESS_TOKEN },
  );
  if (!accessToken.ok) {
    warnRevokeFailed(deps.log, grant, CREDENTIAL_UNREADABLE);
    return;
  }

  const deleted = await deleteUserToken(deps.oauthApp, {
    accessToken: accessToken.value,
  });
  if (!deleted.ok) {
    warnRevokeFailed(deps.log, grant, deleted.error.code);
  }
}

function warnRevokeFailed(
  log: Logger,
  grant: OrphanedGrant,
  code: RevokeFailureCode,
): void {
  log.warn("GitHub token revoke failed; the swept grant is gone", {
    evt: "grant.revoke.fail",
    grantId: String(grant.id),
    code,
  });
}
