// The advisory lock behind `startRun` cannot be proven on PGlite, which runs
// one connection. This suite runs only against a real Postgres named by
// DATABASE_URL and is skipped otherwise.
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { internal } from "../src/db/handle";
import { generation } from "../src/schema/generation";
import { pullRequest } from "../src/schema/pull-request";
import {
  closeDb,
  createDb,
  createGenerationProjection,
  createTenantRepository,
  ensureAppSchema,
  type TenantContext,
} from "../src/index";
import {
  isInstallationId,
  isRepoId,
  PrStates,
  type InstallationId,
  type RepoId,
} from "../src/types";
import { brandWith, makeBriefTarget } from "./helpers";

const databaseUrl = process.env["DATABASE_URL"];
const WINDOW = {
  from: new Date("2000-01-01T00:00:00.000Z"),
  to: new Date("2100-01-01T00:00:00.000Z"),
};
const HOLD_MS = 300;

interface Fixture {
  readonly tenant: InstallationId;
  readonly repoId: RepoId;
  readonly ctx: TenantContext;
}

function makeFixture(): Fixture {
  const stamp = BigInt(Date.now());
  const tenant: InstallationId = brandWith(isInstallationId, stamp);
  return {
    tenant,
    repoId: brandWith(isRepoId, stamp),
    ctx: { installationId: tenant },
  };
}

async function connectMigrated(url: string) {
  const ensured = await ensureAppSchema(url, { autoMigrate: true });
  if (!ensured.ok) throw new Error(ensured.error.message);
  return createDb(url);
}

async function deleteTenantRows(
  handle: ReturnType<typeof createDb>,
  tenant: InstallationId,
): Promise<void> {
  const db = internal(handle);
  await db.delete(generation).where(eq(generation.installationId, tenant));
  await db.delete(pullRequest).where(eq(pullRequest.installationId, tenant));
  await closeDb(handle);
}

function waitMs(ms: number): Promise<"timer"> {
  return new Promise((resolve) => setTimeout(() => resolve("timer"), ms));
}

describe.skipIf(databaseUrl === undefined)("startRun on real Postgres", () => {
  it("two parallel starts at cap 1 start exactly one", async () => {
    if (databaseUrl === undefined) throw new Error("unreachable");
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
        const queued = await projection.upsertQueued(target);
        if (!queued.ok) throw new Error(queued.error.message);
      }

      const outcomes = await Promise.all(
        targets.map((target) =>
          projection.startRun({ target, repoId, cap: 1, ...WINDOW }),
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

  it("a start waits on the repo's advisory lock while another holds it", async () => {
    if (databaseUrl === undefined) throw new Error("unreachable");
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
      const queued = await projection.upsertQueued(target);
      if (!queued.ok) throw new Error(queued.error.message);
      await holding.query("begin");
      await holding.query("select pg_advisory_xact_lock(hashtext($1))", [
        `generation-cap:${repoId}`,
      ]);

      const start = projection.startRun({
        target,
        repoId,
        cap: 1,
        ...WINDOW,
      });
      const whileHeld = await Promise.race([start, waitMs(HOLD_MS)]);
      await holding.query("commit");
      const released = await start;

      expect(whileHeld).toBe("timer");
      if (!released.ok) throw new Error(released.error.message);
      expect(released.value.started).toBe(true);
    } finally {
      holding.release();
      await holder.end();
      await deleteTenantRows(handle, tenant);
    }
  });
});
