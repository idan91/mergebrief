// Every credential row one GitHub user holds, across the three credential
// tables. Unscoped on purpose: the revoke webhook names a user, never a tenant.
import { eq } from "drizzle-orm";
import { type AppDatabase, internal } from "../db/handle";
import { apiToken } from "../schema/api-token";
import { authSession } from "../schema/auth-session";
import { githubGrant } from "../schema/github-grant";
import { insertAudit } from "../stores/audit";
import {
  AuditActorTypes,
  AuditChannels,
  AuditOutcomes,
  type ReviewerId,
} from "../types";
import { PullRequestSources } from "types/pull-requests";

const AUDIT_OPERATION_REVOKE_APP_AUTHORIZATION = "revoke-app-authorization";

/** Rows deleted per table; revoked tokens count among `tokens`. */
export interface UserCredentialsDeleted {
  readonly sessions: number;
  readonly tokens: number;
  readonly grants: number;
}

/**
 * Delete the user's sessions, API tokens (revoked ones too) and grants in one
 * transaction, plus one audit row with the counts. Lock order is sessions,
 * tokens, grants, each table by id, the same as `retireGrant` and the sweeps:
 * a revoke racing a retirement or a sweep batch then waits instead of
 * deadlocking. A grant a concurrent refresh holds `FOR UPDATE` makes the
 * delete wait for that rotation to commit.
 */
export async function deleteUserCredentials(
  handle: AppDatabase,
  userId: ReviewerId,
): Promise<UserCredentialsDeleted> {
  return internal(handle).transaction(async (tx) => {
    await tx
      .select({ id: authSession.id })
      .from(authSession)
      .where(eq(authSession.reviewerId, userId))
      .orderBy(authSession.id)
      .for("update");
    await tx
      .select({ id: apiToken.id })
      .from(apiToken)
      .where(eq(apiToken.userId, userId))
      .orderBy(apiToken.id)
      .for("update");
    await tx
      .select({ id: githubGrant.id })
      .from(githubGrant)
      .where(eq(githubGrant.userId, userId))
      .orderBy(githubGrant.id)
      .for("update");
    const sessions = await tx
      .delete(authSession)
      .where(eq(authSession.reviewerId, userId))
      .returning({ id: authSession.id });
    const tokens = await tx
      .delete(apiToken)
      .where(eq(apiToken.userId, userId))
      .returning({ id: apiToken.id });
    const grants = await tx
      .delete(githubGrant)
      .where(eq(githubGrant.userId, userId))
      .returning({ id: githubGrant.id });

    const deleted = {
      sessions: sessions.length,
      tokens: tokens.length,
      grants: grants.length,
    };
    await insertAudit(tx, {
      installationId: null,
      source: PullRequestSources.URL,
      actorType: AuditActorTypes.REVIEWER,
      actorId: userId,
      operation: AUDIT_OPERATION_REVOKE_APP_AUTHORIZATION,
      outcome: AuditOutcomes.OK,
      channel: AuditChannels.WEBHOOK,
      metadata: deleted,
    });
    return deleted;
  });
}
