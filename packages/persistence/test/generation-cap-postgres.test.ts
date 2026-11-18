// The advisory lock and the row lock behind `claimRun`
// cannot be proven on PGlite, which runs one connection. This suite runs only against a real Postgres named by
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  ClaimEnds,
  ClaimOutcomes,
  createGenerationProjection,
  createTenantRepository,
} from "../src/index";
import { internal } from "../src/db/handle";
import { projectPendingGeneration } from "../src/stores/generation";
import { resolveScope } from "../src/stores/scope";
import { isRepoId, type RepoId } from "../src/types";
import { PrStates } from "types/pull-requests";
import {
  brandWith,
  connectMigrated,
  deleteTenantRows,
  makeBriefTarget,
  makeFixture,
  waitMs,
} from "./helpers";
import { readTestPostgresUrl } from "../src/testing";

const databaseUrl = readTestPostgresUrl(process.env);
const LEASE_MS = 120_000;
const WINDOW = {
  from: new Date("2000-01-01T00:00:00.000Z"),
  to: new Date("2100-01-01T00:00:00.000Z"),
  leaseMs: LEASE_MS,
};
const HOLD_MS = 300;

describe.skipIf(databaseUrl === undefined)("claimRun on real Postgres", () => {
  it("two parallel claims at cap 1 claim exactly one", async () => {
    if (databaseUrl === undefined) {
      throw new Error("unreachable");
    }
    const { tenant, repoId, ctx } = makeFixture();
    const handle = await connectMigrated(databaseUrl);

    try {
      const pr = await createTenantRepository(handle, ctx).pullRequests.upsert({
        repoId,
        prNumber: 1,
        state: PrStates.OPEN,
        repoSlug: "acme/lock",
      });
      const projection = createGenerationProjection(handle, ctx);
      const targets = ["one", "two"].map((headSha) =>
        makeBriefTarget(pr.id, headSha),
      );
      for (const target of targets) {
        await projection.upsertPending(target);
      }

      const outcomes = await Promise.all(
        targets.map((target) =>
          projection.claimRun({ target, cap: 1, ...WINDOW }),
        ),
      );

      const kinds = outcomes.map((outcome) => outcome.ok && outcome.value.kind);
      expect(
        kinds.filter((kind) => kind === ClaimOutcomes.CLAIMED),
      ).toHaveLength(1);
      const refused = outcomes.find(
        (outcome) => outcome.ok && outcome.value.kind === ClaimOutcomes.CAPPED,
      );
      expect(refused?.ok && refused.value).toEqual({
        kind: ClaimOutcomes.CAPPED,
        startedRuns: 1,
        end: ClaimEnds.MARKED,
      });
    } finally {
      await deleteTenantRows(handle, tenant);
    }
  });

  it("two parallel claims in different repos at cap 1 claim exactly one", async () => {
    if (databaseUrl === undefined) {
      throw new Error("unreachable");
    }
    const { tenant, repoId, ctx } = makeFixture();
    const otherRepoId: RepoId = brandWith(isRepoId, repoId + 1n);
    const handle = await connectMigrated(databaseUrl);

    try {
      const pullRequests = createTenantRepository(handle, ctx).pullRequests;
      const prA = await pullRequests.upsert({
        repoId,
        prNumber: 1,
        state: PrStates.OPEN,
        repoSlug: "acme/lock",
      });
      const prB = await pullRequests.upsert({
        repoId: otherRepoId,
        prNumber: 1,
        state: PrStates.OPEN,
        repoSlug: "acme/other",
      });
      const projection = createGenerationProjection(handle, ctx);
      const targets = [
        makeBriefTarget(prA.id, "one"),
        makeBriefTarget(prB.id, "two"),
      ];
      for (const target of targets) {
        await projection.upsertPending(target);
      }

      const outcomes = await Promise.all(
        targets.map((target) =>
          projection.claimRun({ target, cap: 1, ...WINDOW }),
        ),
      );

      const claimed = outcomes.filter(
        (outcome) => outcome.ok && outcome.value.kind === ClaimOutcomes.CLAIMED,
      );
      expect(claimed).toHaveLength(1);
    } finally {
      await deleteTenantRows(handle, tenant);
    }
  });

  it("a claim waits on the instance advisory lock while another holds it", async () => {
    if (databaseUrl === undefined) {
      throw new Error("unreachable");
    }
    const { tenant, repoId, ctx } = makeFixture();
    const handle = await connectMigrated(databaseUrl);
    const holder = new Pool({ connectionString: databaseUrl, max: 1 });
    const holding = await holder.connect();

    try {
      const pr = await createTenantRepository(handle, ctx).pullRequests.upsert({
        repoId,
        prNumber: 1,
        state: PrStates.OPEN,
        repoSlug: "acme/lock",
      });
      const projection = createGenerationProjection(handle, ctx);
      const target = makeBriefTarget(pr.id, "held");
      await projection.upsertPending(target);
      await holding.query("begin");
      await holding.query("select pg_advisory_xact_lock(hashtext($1))", [
        "generation-cap",
      ]);

      const start = projection.claimRun({ target, cap: 1, ...WINDOW });
      const whileHeld = await Promise.race([start, waitMs(HOLD_MS)]);
      await holding.query("commit");
      const released = await start;

      expect(whileHeld).toBe("timer");
      if (!released.ok) {
        throw new Error(released.error.message);
      }
      expect(released.value.kind).toBe(ClaimOutcomes.CLAIMED);
    } finally {
      holding.release();
      await holder.end();
      await deleteTenantRows(handle, tenant);
    }
  });

  it("an exhausted claim waits for a trigger reset and claims after it", async () => {
    if (databaseUrl === undefined) {
      throw new Error("unreachable");
    }
    const { tenant, repoId, ctx } = makeFixture();
    const handle = await connectMigrated(databaseUrl);

    try {
      const pr = await createTenantRepository(handle, ctx).pullRequests.upsert({
        repoId,
        prNumber: 1,
        state: PrStates.OPEN,
        repoSlug: "acme/lock",
      });
      const projection = createGenerationProjection(handle, ctx);
      const target = makeBriefTarget(pr.id, "spent");
      await projection.upsertPending(target);
      await internal(handle).execute(
        sql`update generation set claims = 3 where pull_request_id = ${pr.id}`,
      );
      let releaseReset: () => void = () => undefined;
      const resetHeld = new Promise<void>((resolve) => {
        releaseReset = resolve;
      });
      let markResetWritten: () => void = () => undefined;
      const resetWritten = new Promise<void>((resolve) => {
        markResetWritten = resolve;
      });
      const reset = internal(handle).transaction(async (tx) => {
        await projectPendingGeneration(tx, resolveScope(ctx), target);
        markResetWritten();
        await resetHeld;
      });
      await resetWritten;

      const start = projection.claimRun({ target, ...WINDOW });
      const whileReset = await Promise.race([start, waitMs(HOLD_MS)]);
      releaseReset();
      await reset;
      const claimed = await start;

      expect(whileReset).toBe("timer");
      expect(claimed.ok && claimed.value).toMatchObject({
        kind: ClaimOutcomes.CLAIMED,
        claims: 1,
      });
    } finally {
      await deleteTenantRows(handle, tenant);
    }
  });

  it("two parallel claims on one row claim it exactly once", async () => {
    if (databaseUrl === undefined) {
      throw new Error("unreachable");
    }
    const { tenant, repoId, ctx } = makeFixture();
    const handle = await connectMigrated(databaseUrl);

    try {
      const pr = await createTenantRepository(handle, ctx).pullRequests.upsert({
        repoId,
        prNumber: 1,
        state: PrStates.OPEN,
        repoSlug: "acme/lock",
      });
      const projection = createGenerationProjection(handle, ctx);
      const target = makeBriefTarget(pr.id, "contended");
      await projection.upsertPending(target);

      const outcomes = await Promise.all(
        [1, 2].map(() => projection.claimRun({ target, ...WINDOW })),
      );

      const kinds = outcomes.map((outcome) => outcome.ok && outcome.value.kind);
      expect(kinds).toHaveLength(2);
      expect(kinds).toContain(ClaimOutcomes.CLAIMED);
      expect(kinds).toContain(ClaimOutcomes.HELD);
    } finally {
      await deleteTenantRows(handle, tenant);
    }
  });
});
