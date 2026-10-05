// The advisory lock behind `startRun` cannot be proven on PGlite, which runs
// one connection. This suite runs only against a real Postgres named by
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createTenantRepository,
} from "../src/index";
import { isRepoId, PrStates, type RepoId } from "../src/types";
import {
  brandWith,
  connectMigrated,
  deleteTenantRows,
  makeBriefTarget,
  makeFixture,
  readTestPostgresUrl,
  waitMs,
} from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
const WINDOW = {
  from: new Date("2000-01-01T00:00:00.000Z"),
  to: new Date("2100-01-01T00:00:00.000Z"),
};
const HOLD_MS = 300;

describe.skipIf(databaseUrl === undefined)("startRun on real Postgres", () => {
  it("two parallel starts at cap 1 start exactly one", async () => {
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
        const pending = await projection.upsertPending(target);
        if (!pending.ok) {
          throw new Error(pending.error.message);
        }
      }

      const outcomes = await Promise.all(
        targets.map((target) =>
          projection.startRun({ target, cap: 1, ...WINDOW }),
        ),
      );

      const started = outcomes.filter(
        (outcome) => outcome.ok && outcome.value.started,
      );
      const refused = outcomes.filter(
        (outcome) => outcome.ok && !outcome.value.started,
      );
      expect(started).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.ok && refused[0].value).toEqual({
        started: false,
        startedRuns: 1,
      });
    } finally {
      await deleteTenantRows(handle, tenant);
    }
  });

  it("two parallel starts in different repos at cap 1 start exactly one", async () => {
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
        const pending = await projection.upsertPending(target);
        if (!pending.ok) {
          throw new Error(pending.error.message);
        }
      }

      const outcomes = await Promise.all(
        targets.map((target) =>
          projection.startRun({ target, cap: 1, ...WINDOW }),
        ),
      );

      const started = outcomes.filter(
        (outcome) => outcome.ok && outcome.value.started,
      );
      expect(started).toHaveLength(1);
    } finally {
      await deleteTenantRows(handle, tenant);
    }
  });

  it("a start waits on the instance advisory lock while another holds it", async () => {
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
      const pending = await projection.upsertPending(target);
      if (!pending.ok) {
        throw new Error(pending.error.message);
      }
      await holding.query("begin");
      await holding.query("select pg_advisory_xact_lock(hashtext($1))", [
        "generation-cap",
      ]);

      const start = projection.startRun({ target, cap: 1, ...WINDOW });
      const whileHeld = await Promise.race([start, waitMs(HOLD_MS)]);
      await holding.query("commit");
      const released = await start;

      expect(whileHeld).toBe("timer");
      if (!released.ok) {
        throw new Error(released.error.message);
      }
      expect(released.value.started).toBe(true);
    } finally {
      holding.release();
      await holder.end();
      await deleteTenantRows(handle, tenant);
    }
  });
});
