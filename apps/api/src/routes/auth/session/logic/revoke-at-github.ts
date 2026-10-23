// Runs after the delete has committed, never inside its transaction: a GitHub
// call holds no row lock and no pool connection. Best-effort by decision: a
// failure warns and the caller's answer stands.
import { createOAuthApp, deleteUserToken, type OAuthErrorCode } from "github";
import type { Logger } from "logging";
import {
  decryptToken,
  GrantSealedColumns,
  type OrphanedGrant,
} from "persistence";
import type { AuthRouteDeps } from "../types";

const CREDENTIAL_UNREADABLE = "credential-unreadable";

/** The `code` set the `grant.revoke.fail` line documents. */
type RevokeFailureCode = OAuthErrorCode | typeof CREDENTIAL_UNREADABLE;

/** Revoke each orphaned grant's access token at GitHub, bounded by the OAuth timeout. */
export async function revokeOrphanedGrantsAtGitHub(
  deps: AuthRouteDeps,
  orphanedGrants: readonly OrphanedGrant[],
  log: Logger,
): Promise<void> {
  if (orphanedGrants.length === 0) {
    return;
  }
  const oauthApp = createOAuthApp({
    clientId: deps.auth.oauthClientId,
    clientSecret: deps.auth.oauthClientSecret,
    requestTimeoutMs: deps.auth.oauthRequestTimeoutMs,
  });

  await Promise.all(
    orphanedGrants.map(async (grant) => {
      const accessToken = await decryptToken(
        deps.auth.keyProvider,
        grant.keyRef,
        grant.ghTokenCiphertext,
        { grantId: grant.id, column: GrantSealedColumns.ACCESS_TOKEN },
      );
      if (!accessToken.ok) {
        warnRevokeFailed(log, grant, CREDENTIAL_UNREADABLE);
        return;
      }
      const deleted = await deleteUserToken(oauthApp, {
        accessToken: accessToken.value,
      });
      if (!deleted.ok) {
        warnRevokeFailed(log, grant, deleted.error.code);
      }
    }),
  );
}

function warnRevokeFailed(
  log: Logger,
  grant: OrphanedGrant,
  code: RevokeFailureCode,
): void {
  log.warn("GitHub token revoke failed; the local grant is gone", {
    evt: "grant.revoke.fail",
    grantId: String(grant.id),
    code,
  });
}
