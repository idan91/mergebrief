import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deleteUserCredentials } from "../src/auth/credentials";
import { createGrantAuth } from "../src/auth/grant";
import { createSessionAuth } from "../src/auth/session";
import { createTokenAuth } from "../src/auth/token";
import { internal, type AppDatabase } from "../src/db/handle";
import { apiToken } from "../src/schema/api-token";
import { auditLog } from "../src/schema/audit-log";
import { authSession } from "../src/schema/auth-session";
import { githubGrant } from "../src/schema/github-grant";
import { isReviewerId, type ReviewerId } from "../src/types";
import { AccessLevels } from "types/access-levels";
import { brandWith, registerSharedPglite } from "./helpers";

const shared = registerSharedPglite();

const USER: ReviewerId = brandWith(isReviewerId, 777n);
const OTHER_USER: ReviewerId = brandWith(isReviewerId, 888n);
const FUTURE = new Date("2027-01-01T00:00:00Z");
const NOW = new Date("2026-10-23T00:00:00Z");

async function seedSignedInUser(
  handle: AppDatabase,
  userId: ReviewerId,
  label: string,
): Promise<void> {
  const grant = await createGrantAuth(handle).createGrant({
    userId,
    ghTokenCiphertext: `v1.${label}-access`,
    ghRefreshTokenCiphertext: `v1.${label}-refresh`,
    keyRef: "SESSION_KEY_V1",
    refreshExpiresAt: FUTURE,
  });
  await createSessionAuth(handle).createSession({
    sessionTokenHash: `${label}-session`,
    reviewerId: userId,
    reviewerLogin: label,
    grantId: grant.id,
    expiresAt: FUTURE,
  });
  const tokens = createTokenAuth(handle);
  await tokens.mintToken({
    scope: AccessLevels.READ,
    userId,
    userLogin: label,
    name: "live",
    tokenHash: `${label}-live`,
    grantId: grant.id,
    expiresAt: null,
  });
  const revoked = await tokens.mintToken({
    scope: AccessLevels.READ,
    userId,
    userLogin: label,
    name: "revoked",
    tokenHash: `${label}-revoked`,
    grantId: grant.id,
    expiresAt: null,
  });
  await tokens.revokeToken(userId, revoked.id, NOW);
}

async function countUserRows(
  handle: AppDatabase,
  userId: ReviewerId,
): Promise<number[]> {
  const db = internal(handle);
  const sessions = await db
    .select({ id: authSession.id })
    .from(authSession)
    .where(eq(authSession.reviewerId, userId));
  const tokens = await db
    .select({ id: apiToken.id })
    .from(apiToken)
    .where(eq(apiToken.userId, userId));
  const grants = await db
    .select({ id: githubGrant.id })
    .from(githubGrant)
    .where(eq(githubGrant.userId, userId));
  return [sessions.length, tokens.length, grants.length];
}

describe("deleteUserCredentials", () => {
  it("deletes the user's sessions, tokens and grants and counts them", async () => {
    await seedSignedInUser(shared.handle, USER, "mine");

    const deleted = await deleteUserCredentials(shared.handle, USER);

    expect(deleted).toEqual({ sessions: 1, tokens: 2, grants: 1 });
    expect(await countUserRows(shared.handle, USER)).toEqual([0, 0, 0]);
  });

  it("leaves another user's credentials in place", async () => {
    await seedSignedInUser(shared.handle, USER, "mine");
    await seedSignedInUser(shared.handle, OTHER_USER, "theirs");

    await deleteUserCredentials(shared.handle, USER);

    expect(await countUserRows(shared.handle, OTHER_USER)).toEqual([1, 2, 1]);
  });

  it("writes one audit row naming the user and the counts", async () => {
    await seedSignedInUser(shared.handle, USER, "mine");

    await deleteUserCredentials(shared.handle, USER);

    const rows = await internal(shared.handle)
      .select()
      .from(auditLog)
      .where(eq(auditLog.operation, "revoke-app-authorization"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: "reviewer",
      channel: "webhook",
      source: "url",
      outcome: "ok",
    });
    expect(rows[0]?.actorId).toBe(777n);
    expect(rows[0]?.installationId).toBeNull();
    expect(rows[0]?.metadata).toEqual({ sessions: 1, tokens: 2, grants: 1 });
  });

  it("deletes nothing for a user with no credentials", async () => {
    const deleted = await deleteUserCredentials(shared.handle, USER);

    expect(deleted).toEqual({ sessions: 0, tokens: 0, grants: 0 });
  });
});
