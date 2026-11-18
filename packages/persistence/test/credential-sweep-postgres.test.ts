// The sweep locks a dead grant before it deletes it. A mint holding a new live
// token on that grant makes the sweep wait, and its re-check then keeps the
// grant. PGlite runs one connection, so this suite runs only against a real
// Postgres named by MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset,
// red under CI.
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepDeadCredentials } from "../src/auth/credential-sweep";
import { deleteUserCredentials } from "../src/auth/credentials";
import type { OrphanedGrant } from "../src/auth/grant";
import { createTokenAuth } from "../src/auth/token";
import {
  closeDb,
  createDb,
  internal,
  type AppDatabase,
} from "../src/db/handle";
import { apiToken } from "../src/schema/api-token";
import { githubGrant } from "../src/schema/github-grant";
import { readTestPostgresUrl } from "../src/testing";
import type { ReviewerId } from "../src/types";
import { AccessLevels } from "types/access-levels";
import {
  connectMigrated,
  makeFixtureReviewer,
  makeGrant,
  waitMs,
} from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
const POOL_SIZE = 3;
const SWEEP_BLOCKED_MS = 300;
const NOW = new Date("2026-10-23T12:00:00Z");
const REVOKED_AT = new Date("2026-10-22T12:00:00Z");

function makeTokenHash(): string {
  return randomBytes(32).toString("hex");
}

describe.skipIf(databaseUrl === undefined)(
  "sweepDeadCredentials on real Postgres",
  () => {
    let handle: AppDatabase;
    let reviewer: ReviewerId;

    beforeEach(async () => {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      await closeDb(await connectMigrated(databaseUrl));
      handle = createDb(databaseUrl, { maxConnections: POOL_SIZE });
      reviewer = makeFixtureReviewer();
    });

    afterEach(async () => {
      await deleteUserCredentials(handle, reviewer);
      await closeDb(handle);
    });

    it("keeps a dead grant a concurrent mint gives a live token", async () => {
      const grant = await makeGrant(handle, reviewer);
      const tokens = createTokenAuth(handle);
      const dead = await tokens.mintToken({
        userId: reviewer,
        name: "revoked",
        scope: AccessLevels.READ,
        tokenHash: makeTokenHash(),
        grantId: grant.id,
        expiresAt: null,
      });
      await tokens.revokeToken(reviewer, dead.id, REVOKED_AT);

      let releaseMint = (): void => {};
      const mintHeld = new Promise<void>((resolve) => {
        releaseMint = resolve;
      });
      let signalInserted = (): void => {};
      const inserted = new Promise<void>((resolve) => {
        signalInserted = resolve;
      });
      const mint = internal(handle).transaction(async (tx) => {
        await tx.insert(apiToken).values({
          userId: reviewer,
          name: "minted-mid-sweep",
          scope: AccessLevels.READ,
          tokenHash: makeTokenHash(),
          grantId: grant.id,
        });
        signalInserted();
        await mintHeld;
      });
      await inserted;

      const swept: OrphanedGrant[] = [];
      const sweep = sweepDeadCredentials(handle, NOW, (grants) => {
        swept.push(...grants);
      });
      await waitMs(SWEEP_BLOCKED_MS);
      releaseMint();
      await mint;
      await sweep;

      expect(swept.filter(({ id }) => id === grant.id)).toEqual([]);
      const survivors = await internal(handle)
        .select({ id: githubGrant.id })
        .from(githubGrant)
        .where(eq(githubGrant.id, grant.id));
      expect(survivors).toHaveLength(1);
    });
  },
);
