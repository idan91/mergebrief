// A rotation holds its grant's row lock and one pool connection while GitHub
// answers. PGlite runs one connection, so this suite runs only against a real
// Postgres named by MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset,
// red under CI.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGrantAuth,
  GrantAuthErrorCodes,
  type GrantAuth,
} from "../src/auth/grant";
import { closeDb, createDb, type AppDatabase } from "../src/db/handle";
import { readTestPostgresUrl } from "../src/testing";
import type { GrantRowId } from "../src/types";
import { connectMigrated, waitMs } from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
const ROTATION_BOUND_MS = 1_000;
const LOCK_HOLD_MS = 4_000;
const WAITER_COUNT = 3;
const POOL_SIZE = 2;
const WAITERS_POOL_SIZE = WAITER_COUNT + 1;
const SUITE_TIMEOUT_MS = 15_000;
const FUTURE = new Date("2027-01-01T00:00:00Z");

function makeGrantInput(label: string) {
  return {
    ghTokenCiphertext: `v1.${label}-access`,
    ghRefreshTokenCiphertext: `v1.${label}-refresh`,
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
  "refreshGrant on real Postgres",
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
      const seed = await auth.createGrant(makeGrantInput("warm"));
      created.push(seed.id);
      // Open every connection up front, so no timing below pays a connect.
      await Promise.all(
        Array.from({ length: size }, () => auth.getGrant(seed.id)),
      );
    }

    async function makeGrant(label: string) {
      const grant = await auth.createGrant(makeGrantInput(label));
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
      const hung = await makeGrant("hung");
      const other = await makeGrant("other");
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
        async () => ({ ok: true, value: makeGrantInput("rotated") }),
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
        const grant = await makeGrant("contended");
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
              return { ok: true, value: makeGrantInput("never") };
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
  },
);
