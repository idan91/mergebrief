// A rotation holds its grant's row lock and one pool connection while GitHub
// answers, and concurrent sign-ins draw grant ids in parallel transactions.
// PGlite runs one connection, so this suite runs only against a real Postgres
// named by MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red
// under CI.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptToken } from "../src/auth/crypto";
import {
  createGrantAuth,
  GrantAuthErrorCodes,
  type GrantAuth,
  type GrantRefreshPatch,
} from "../src/auth/grant";
import { GrantSealedColumns } from "../src/auth/types";
import { closeDb, createDb, type AppDatabase } from "../src/db/handle";
import {
  buildNamedPostgresUrl,
  readTestPostgresUrl,
  terminateIdleTransactions,
  waitUntil,
} from "../src/testing";
import { isReviewerId, type GrantRowId } from "../src/types";
import {
  brandWith,
  connectMigrated,
  makeGrant,
  TEST_KEY_PROVIDER,
  waitMs,
} from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
const ROTATION_BOUND_MS = 1_000;
const LOCK_HOLD_MS = 4_000;
const WAITER_COUNT = 3;
const POOL_SIZE = 2;
const WAITERS_POOL_SIZE = WAITER_COUNT + 1;
const SUITE_TIMEOUT_MS = 15_000;
const FUTURE = new Date("2027-01-01T00:00:00Z");

const CONCURRENT_SIGN_INS = 8;
const HELD_REFRESH_APPLICATION = "grant-held-refresh";
const CLIENT_END_WAIT_MS = 5_000;

const REVIEWER = brandWith(isReviewerId, 777n);

function makeRotationPatch(label: string): GrantRefreshPatch {
  return {
    ghTokenCiphertext: `v2.${label}-access`,
    ghRefreshTokenCiphertext: `v2.${label}-refresh`,
    keyRef: "SESSION_KEY_V1",
    refreshExpiresAt: FUTURE,
  };
}

function stubHungRotation(holdMs: number) {
  return async () => {
    await waitMs(holdMs);
    return { ok: false, error: { reason: "github-unavailable" } } as const;
  };
}

describe.skipIf(databaseUrl === undefined)(
  "the grant boundary on real Postgres",
  () => {
    let handle: AppDatabase;
    let auth: GrantAuth;
    const created: GrantRowId[] = [];

    async function openPool(size: number): Promise<void> {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      handle = createDb(databaseUrl, { maxConnections: size });
      auth = createGrantAuth(handle);
      const seed = await makePooledGrant();
      // Open every connection up front, so no timing below pays a connect.
      await Promise.all(
        Array.from({ length: size }, () => auth.getGrant(seed.id)),
      );
    }

    async function makePooledGrant() {
      const grant = await makeGrant(handle, REVIEWER, FUTURE);
      created.push(grant.id);
      return grant;
    }

    beforeEach(async () => {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      await closeDb(await connectMigrated(databaseUrl));
    });

    afterEach(async () => {
      for (const grantId of created.splice(0)) {
        await auth.deleteIfOrphaned(grantId);
      }
      await closeDb(handle);
    });

    it("frees its connection at the bound while another grant rotates", async () => {
      await openPool(POOL_SIZE);
      const hung = await makePooledGrant();
      const other = await makePooledGrant();
      let hungSettled = false;

      const hungRefresh = auth
        .refreshGrant(
          hung.id,
          hung.ghTokenCiphertext,
          stubHungRotation(ROTATION_BOUND_MS),
        )
        .finally(() => {
          hungSettled = true;
        });
      const otherResult = await auth.refreshGrant(
        other.id,
        other.ghTokenCiphertext,
        async () => ({ ok: true, value: makeRotationPatch("rotated") }),
      );
      const settledBeforeOther = hungSettled;

      expect(otherResult.ok).toBe(true);
      expect(settledBeforeOther).toBe(false);
      const hungResult = await hungRefresh;
      expect(hungResult.ok || hungResult.error.code).toBe(
        GrantAuthErrorCodes.REFRESH_REJECTED,
      );
    });

    it(
      "times out waiters on a held grant without calling GitHub again",
      async () => {
        await openPool(WAITERS_POOL_SIZE);
        const grant = await makePooledGrant();
        let waiterRotations = 0;

        let signalLockHeld = (): void => {};
        const lockHeld = new Promise<void>((resolve) => {
          signalLockHeld = resolve;
        });
        const hold = stubHungRotation(LOCK_HOLD_MS);

        const holder = auth.refreshGrant(
          grant.id,
          grant.ghTokenCiphertext,
          async () => {
            signalLockHeld();
            return hold();
          },
        );
        await lockHeld;
        const waiters = await Promise.all(
          Array.from({ length: WAITER_COUNT }, () =>
            auth.refreshGrant(grant.id, grant.ghTokenCiphertext, async () => {
              waiterRotations += 1;
              return { ok: true, value: makeRotationPatch("never") };
            }),
          ),
        );

        expect(waiters.map((result) => result.ok || result.error.code)).toEqual(
          Array.from(
            { length: WAITER_COUNT },
            () => GrantAuthErrorCodes.LOCK_TIMEOUT,
          ),
        );
        expect(waiterRotations).toBe(0);
        const held = await holder;
        expect(held.ok || held.error.code).toBe(
          GrantAuthErrorCodes.REFRESH_REJECTED,
        );
      },
      SUITE_TIMEOUT_MS,
    );

    it("fails a held refresh Postgres ends without crashing the process", async () => {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      const uncaught: unknown[] = [];
      const forwarded: Error[] = [];
      function recordUncaught(error: unknown): void {
        uncaught.push(error);
      }
      process.on("uncaughtException", recordUncaught);
      handle = createDb(
        buildNamedPostgresUrl(databaseUrl, HELD_REFRESH_APPLICATION),
        {
          maxConnections: POOL_SIZE,
          onError: (error) => forwarded.push(error),
        },
      );
      auth = createGrantAuth(handle);
      const observer = createDb(databaseUrl);
      const grant = await makePooledGrant();

      let signalLockHeld = (): void => {};
      const lockHeld = new Promise<void>((resolve) => {
        signalLockHeld = resolve;
      });
      let releaseRotation = (): void => {};
      const rotationReleased = new Promise<void>((resolve) => {
        releaseRotation = resolve;
      });
      const refresh = auth.refreshGrant(
        grant.id,
        grant.ghTokenCiphertext,
        async () => {
          signalLockHeld();
          await rotationReleased;
          return {
            ok: false,
            error: { reason: "github-unavailable" },
          } as const;
        },
      );
      await lockHeld;
      const ended = await terminateIdleTransactions(
        observer,
        HELD_REFRESH_APPLICATION,
      );
      await waitUntil(
        () => forwarded.length + uncaught.length > 0,
        CLIENT_END_WAIT_MS,
      );
      releaseRotation();
      const outcome = await refresh.then(
        () => "resolved",
        () => "rejected",
      );
      process.off("uncaughtException", recordUncaught);
      await closeDb(observer);

      expect(ended).toBe(1);
      expect(uncaught).toEqual([]);
      expect(forwarded.length).toBeGreaterThan(0);
      expect(outcome).toBe("rejected");
      const after = await auth.getGrant(grant.id);
      expect(after?.ghTokenCiphertext).toBe(grant.ghTokenCiphertext);
    });

    it("gives concurrent sign-ins distinct ids, each sealed to its own", async () => {
      await openPool(WAITERS_POOL_SIZE);

      const grants = await Promise.all(
        Array.from({ length: CONCURRENT_SIGN_INS }, () => makePooledGrant()),
      );
      const opened = await Promise.all(
        grants.map((grant) =>
          decryptToken(
            TEST_KEY_PROVIDER,
            grant.keyRef,
            grant.ghTokenCiphertext,
            {
              grantId: grant.id,
              column: GrantSealedColumns.ACCESS_TOKEN,
            },
          ),
        ),
      );

      expect(new Set(grants.map((grant) => grant.id)).size).toBe(
        CONCURRENT_SIGN_INS,
      );
      expect(opened.every((result) => result.ok)).toBe(true);
    });
  },
);
