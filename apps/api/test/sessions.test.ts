// DELETE /api/auth/sessions: the "sign out everywhere" a leaked cookie needs.
// Owner-bound (another reviewer's rows stay), grant-safe (a token minted off
// a revoked session keeps working), cookie-only, and same-origin like every
// cookie mutation.
import { randomBytes } from "node:crypto";
import {
  createGrantAuth,
  createTenantRepository,
  createTokenAuth,
  encryptToken,
  WriteClassifications,
  type AppDatabase,
  type GithubGrantRow,
  type KeyProvider,
  type ReviewerId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import {
  KEY_REF,
  REVIEWER_ID,
  SAME_ORIGIN_HEADERS,
  SECRET,
  brandReviewerId,
  buildAuthDeps,
  createKeyProvider,
  hashSha256Hex,
} from "./fixtures";
import { testLogger } from "./logging";

const OTHER_REVIEWER_ID = 777;
const REVOKE_PATH = "/api/auth/sessions";

const unusedGitHubPort = {
  fetchPullRequestConversation: () => {
    throw new Error("conversation port must not be called");
  },
  listRepoCollaborators: () => {
    throw new Error("collaborators port must not be called");
  },
  commitAttachment: async () => {
    throw new Error("attachment port must not be called in this suite");
  },
};

interface SeededSession {
  readonly cookie: string;
  readonly grantId: GithubGrantRow["id"];
}

async function seedSessionFor(
  handle: AppDatabase,
  kp: KeyProvider,
  reviewerId: ReviewerId,
): Promise<SeededSession> {
  const cookie = randomBytes(32).toString("base64url");
  const sealedAccess = await encryptToken(kp, KEY_REF, "ghu_ACCESS");
  const sealedRefresh = await encryptToken(kp, KEY_REF, "ghr_REFRESH");
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed encrypt failed");
  }
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: KEY_REF,
    refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  await createTenantRepository(handle, {
    ownerUserId: reviewerId,
  }).sessions.create({
    sessionTokenHash: hashSha256Hex(cookie),
    reviewerId,
    reviewerLogin: `reviewer-${String(reviewerId)}`,
    grantId: grant.id,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  return { cookie, grantId: grant.id };
}

async function countRows(
  harness: PgliteHarness,
  table: string,
): Promise<number> {
  const rows = await harness.raw(`select count(*)::int as n from ${table}`);
  const n = rows[0]?.["n"];
  if (typeof n !== "number") {
    throw new Error(`count of ${table} is not a number`);
  }
  return n;
}

describe("DELETE /api/auth/sessions", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;
  let app: ApiApp;
  const reviewer = brandReviewerId(BigInt(REVIEWER_ID));
  const otherReviewer = brandReviewerId(BigInt(OTHER_REVIEWER_ID));

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: unusedGitHubPort,
    });
  });

  afterEach(async () => {
    await harness.close();
  });

  function revokeAll(cookie: string, headers: Record<string, string> = {}) {
    return app.request(REVOKE_PATH, {
      method: "DELETE",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${cookie}`,
        ...headers,
      },
    });
  }

  function probe(cookie: string) {
    return app.request("/api/auth/session", {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("revokes every session of the reviewer and clears the cookie", async () => {
    const laptop = await seedSessionFor(harness.handle, kp, reviewer);
    const phone = await seedSessionFor(harness.handle, kp, reviewer);
    const stranger = await seedSessionFor(harness.handle, kp, otherReviewer);

    const res = await revokeAll(laptop.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: 2 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith("__Host-mergebrief_session=")).toBe(true);
    expect(setCookie).toContain("Secure");
    expect(setCookie).toMatch(/Max-Age=0/i);

    expect((await probe(laptop.cookie)).status).toBe(401);
    expect((await probe(phone.cookie)).status).toBe(401);
    expect((await probe(stranger.cookie)).status).toBe(200);
    expect(await countRows(harness, "auth_session")).toBe(1);
  });

  it("keeps a grant an API token still links", async () => {
    const seeded = await seedSessionFor(harness.handle, kp, reviewer);
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    await createTokenAuth(harness.handle).mintToken({
      scope: WriteClassifications.READ,
      userId: reviewer,
      userLogin: "octocat",
      name: "ci-token",
      tokenHash: hashSha256Hex(plaintext),
      grantId: seeded.grantId,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });

    const res = await revokeAll(seeded.cookie);

    expect(res.status).toBe(200);
    expect(await countRows(harness, "auth_session")).toBe(0);
    expect(await countRows(harness, "github_grant")).toBe(1);
    const viaBearer = await app.request("/api/capabilities", {
      headers: { Authorization: `Bearer ${plaintext}` },
    });
    expect(viaBearer.status).toBe(200);
  });

  it("answers 401 without a cookie and ignores Bearer", async () => {
    const seeded = await seedSessionFor(harness.handle, kp, reviewer);
    const plaintext = `mergebrief_${randomBytes(32).toString("base64url")}`;
    await createTokenAuth(harness.handle).mintToken({
      scope: WriteClassifications.EXTERNAL_WRITE,
      userId: reviewer,
      userLogin: "octocat",
      name: "ci-token",
      tokenHash: hashSha256Hex(plaintext),
      grantId: seeded.grantId,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });

    const bare = await app.request(REVOKE_PATH, {
      method: "DELETE",
      headers: SAME_ORIGIN_HEADERS,
    });
    const viaBearer = await app.request(REVOKE_PATH, {
      method: "DELETE",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Authorization: `Bearer ${plaintext}`,
      },
    });

    expect(bare.status).toBe(401);
    expect(viaBearer.status).toBe(401);
    expect(await countRows(harness, "auth_session")).toBe(1);
  });

  it("refuses a revoke that proves no origin", async () => {
    const seeded = await seedSessionFor(harness.handle, kp, reviewer);

    const res = await app.request(REVOKE_PATH, {
      method: "DELETE",
      headers: { Cookie: `__Host-mergebrief_session=${seeded.cookie}` },
    });

    expect(res.status).toBe(403);
    expect(await countRows(harness, "auth_session")).toBe(1);
  });

  it("writes one audit row naming the reviewer", async () => {
    const seeded = await seedSessionFor(harness.handle, kp, reviewer);

    await revokeAll(seeded.cookie);

    const rows = await harness.raw(
      "select operation, outcome, target_type, target_id::text as target_id from audit_log",
    );
    expect(rows).toEqual([
      {
        operation: "revoke-sessions",
        outcome: "ok",
        target_type: "reviewer",
        target_id: String(REVIEWER_ID),
      },
    ]);
  });
});
