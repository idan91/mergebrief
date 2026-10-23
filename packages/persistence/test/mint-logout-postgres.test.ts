// A browser mint racing a logout over one grant that a revoked token keeps
// alive. The interleavings need several connections, so this suite runs only
// against a real Postgres named by MERGEBRIEF_TEST_POSTGRES_URL.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteUserCredentials } from "../src/auth/credentials";
import { createGrantAuth, type GithubGrantRow } from "../src/auth/grant";
import { createSessionAuth } from "../src/auth/session";
import { createTokenAuth, type TokenMintInput } from "../src/auth/token";
import { TokenMintErrorCodes } from "../src/auth/types";
import { closeDb, createDb, type AppDatabase } from "../src/db/handle";
import { readTestPostgresUrl } from "../src/testing";
import { isReviewerId, type ReviewerId } from "../src/types";
import { AccessLevels } from "types/access-levels";
import { brandWith, connectMigrated, makeGrant, waitMs } from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
const POOL_SIZE = 4;
const GRANT_HOLD_MS = 800;
const SETTLE_MS = 150;
const SUITE_TIMEOUT_MS = 15_000;
const FUTURE = new Date("2027-06-01T00:00:00Z");
const MAX_TEST_USER_ID = 1_000_000_000;

interface SignedIn {
  readonly user: ReviewerId;
  readonly grant: GithubGrantRow;
  readonly sessionHash: string;
}

function makeHash(): string {
  return randomBytes(32).toString("hex");
}

function makeMintInput(signedIn: SignedIn): TokenMintInput {
  return {
    userId: signedIn.user,
    userLogin: "octocat",
    name: "cli",
    scope: AccessLevels.READ,
    tokenHash: makeHash(),
    grantId: signedIn.grant.id,
    expiresAt: null,
  };
}

describe.skipIf(databaseUrl === undefined)(
  "browser mint against a concurrent logout on real Postgres",
  () => {
    let handle: AppDatabase;
    const users: ReviewerId[] = [];

    beforeEach(async () => {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      await closeDb(await connectMigrated(databaseUrl));
      handle = createDb(databaseUrl, { maxConnections: POOL_SIZE });
    });

    afterEach(async () => {
      for (const user of users.splice(0)) {
        await deleteUserCredentials(handle, user);
      }
      await closeDb(handle);
    });

    /** A session and a revoked CLI token on one grant: the grant row outlives a logout. */
    async function makeSignedInWithRevokedToken(): Promise<SignedIn> {
      const user = brandWith(
        isReviewerId,
        BigInt(1 + Math.floor(Math.random() * MAX_TEST_USER_ID)),
      );
      users.push(user);
      const grant = await makeGrant(handle, user, FUTURE);
      const sessionHash = makeHash();
      await createSessionAuth(handle).createSession({
        sessionTokenHash: sessionHash,
        reviewerId: user,
        grantId: grant.id,
        expiresAt: FUTURE,
      });
      const signedIn = { user, grant, sessionHash };
      const tokens = createTokenAuth(handle);
      const revoked = await tokens.mintToken(makeMintInput(signedIn));
      await tokens.revokeToken(user, revoked.id, new Date());
      return signedIn;
    }

    it(
      "refuses a mint whose session a committed logout deleted",
      async () => {
        const signedIn = await makeSignedInWithRevokedToken();
        const loggedOut = await createSessionAuth(handle).deleteSession(
          signedIn.sessionHash,
        );

        const minted = await createTokenAuth(handle).mintTokenFromSession(
          signedIn.sessionHash,
          makeMintInput(signedIn),
        );

        expect(loggedOut.orphanedGrants.map((grant) => grant.id)).toEqual([
          signedIn.grant.id,
        ]);
        expect(minted.ok ? undefined : minted.error.code).toBe(
          TokenMintErrorCodes.SESSION_GONE,
        );
      },
      SUITE_TIMEOUT_MS,
    );

    it(
      "makes a logout wait for an in-flight mint and keep its grant",
      async () => {
        const signedIn = await makeSignedInWithRevokedToken();
        const grantHeld = createGrantAuth(handle).refreshGrant(
          signedIn.grant.id,
          signedIn.grant.ghTokenCiphertext,
          async () => {
            await waitMs(GRANT_HOLD_MS);
            return { ok: false, error: { reason: "held-for-test" } };
          },
        );
        await waitMs(SETTLE_MS);
        const minting = createTokenAuth(handle).mintTokenFromSession(
          signedIn.sessionHash,
          makeMintInput(signedIn),
        );
        await waitMs(SETTLE_MS);
        const loggingOut = createSessionAuth(handle).deleteSession(
          signedIn.sessionHash,
        );

        const [, minted, loggedOut] = await Promise.all([
          grantHeld,
          minting,
          loggingOut,
        ]);

        expect(minted.ok).toBe(true);
        expect(loggedOut).toEqual({ deleted: 1, orphanedGrants: [] });
      },
      SUITE_TIMEOUT_MS,
    );

    it(
      "keeps the grant when a logout follows a committed mint",
      async () => {
        const signedIn = await makeSignedInWithRevokedToken();
        const minted = await createTokenAuth(handle).mintTokenFromSession(
          signedIn.sessionHash,
          makeMintInput(signedIn),
        );

        const loggedOut = await createSessionAuth(handle).deleteSession(
          signedIn.sessionHash,
        );

        expect(minted.ok).toBe(true);
        expect(loggedOut.orphanedGrants).toEqual([]);
      },
      SUITE_TIMEOUT_MS,
    );
  },
);
