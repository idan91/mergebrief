// The e2e database seed, run by the global setup (via tsx) after postgres is
// up and before the web server boots: migrate, ingest the committed fixture
// artifacts under the owner world, and create the browser session.
import { createHash } from "node:crypto";
import { migrateQueue } from "api";
import { ingestBriefDirectory } from "ingest-briefs";
import {
  closeDb,
  createDb,
  createGrantAuth,
  createTenantRepository,
  encryptToken,
  createEnvKeyProvider,
  ensureAppSchema,
  isRepoId,
  isReviewerId,
  PrStates,
  type ReviewerId,
} from "persistence";
import {
  E2E_DATABASE_URL,
  E2E_OWNER_USER_ID,
  E2E_REPO_ID,
  E2E_SESSION_COOKIE,
  E2E_SESSION_KEY,
  FIXTURE_DIR,
} from "./env";

function brandReviewer(value: bigint): ReviewerId {
  if (!isReviewerId(value)) throw new Error("bad owner id");
  return value;
}

async function main(): Promise<void> {
  const ensured = await ensureAppSchema(E2E_DATABASE_URL, {
    autoMigrate: true,
  });
  if (!ensured.ok) {
    throw new Error(`migrate failed: ${ensured.error.message}`);
  }
  await migrateQueue(E2E_DATABASE_URL);

  const handle = createDb(E2E_DATABASE_URL);
  try {
    const owner = brandReviewer(E2E_OWNER_USER_ID);
    const repoId = BigInt(E2E_REPO_ID);
    if (!isRepoId(repoId)) throw new Error("bad repo id");
    const summary = await ingestBriefDirectory(handle, {
      dir: FIXTURE_DIR,
      ctx: { ownerUserId: owner },
      resolveRepo: async () => ({
        repoId,
        lifecycle: { state: PrStates.OPEN },
      }),
    });
    if (summary.briefs === 0) {
      throw new Error("seed ingested no briefs — fixture dir wrong?");
    }

    // The browser session: a grant with sealed throwaway tokens + the
    // owner-world session row whose cookie the storage state carries.
    const keyProvider = createEnvKeyProvider({
      SESSION_KEY_V1: E2E_SESSION_KEY,
    });
    const sealedAccess = await encryptToken(
      keyProvider,
      "SESSION_KEY_V1",
      "ghu_e2e_access_token",
    );
    const sealedRefresh = await encryptToken(
      keyProvider,
      "SESSION_KEY_V1",
      "ghr_e2e_refresh_token",
    );
    if (!sealedAccess.ok || !sealedRefresh.ok) {
      throw new Error("seed encrypt failed");
    }
    const grant = await createGrantAuth(handle).createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: "SESSION_KEY_V1",
      refreshExpiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
    });
    await createTenantRepository(handle, {
      ownerUserId: owner,
    }).sessions.create({
      sessionTokenHash: createHash("sha256")
        .update(E2E_SESSION_COOKIE)
        .digest("hex"),
      reviewerId: owner,
      reviewerLogin: "e2e-viewer",
      grantId: grant.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
    });
    process.stdout.write(
      `seeded: ${String(summary.briefs)} briefs, ${String(summary.narratives)} narratives, ${String(summary.marks)} marks\n`,
    );
  } finally {
    await closeDb(handle);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `e2e seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
