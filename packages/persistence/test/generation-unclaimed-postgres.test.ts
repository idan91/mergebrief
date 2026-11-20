// An unclaimed settle against a trigger transaction open at pickup, on a real
// Postgres named by MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset,
// red under CI.
// Rows are staged by raw updates, never a claim: an attempt row would count
// against the instance-wide cap the generation-cap suite asserts in parallel.
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  createGenerationProjection,
  createTenantRepository,
  type GenerationProjection,
} from "../src/index";
import { readTestPostgresUrl } from "../src/testing";
import { internal, type AppDatabase } from "../src/db/handle";
import { projectPendingGeneration } from "../src/stores/generation";
import { resolveScope } from "../src/stores/scope";
import type { TenantContext } from "../src/stores/scope-context";
import type { InstallationId } from "../src/types";
import { GenerationStatuses, PrStates } from "types";
import {
  connectMigrated,
  deleteTenantRows,
  makeBriefTarget,
  makeFixture,
} from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
/** How far an api host's clock may lag the database's. */
const WRITER_CLOCK_LAG_MS = 60_000;

interface UnclaimedWorld {
  readonly handle: AppDatabase;
  readonly tenant: InstallationId;
  readonly ctx: TenantContext;
  readonly gen: GenerationProjection;
  readonly target: ReturnType<typeof makeBriefTarget>;
  /** Raw SQL on the world's one generation row. */
  readonly stage: (assignments: string) => Promise<void>;
}

async function openWorld(url: string): Promise<UnclaimedWorld> {
  const { tenant, repoId, ctx } = makeFixture();
  const handle = await connectMigrated(url);
  const pr = await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId,
    prNumber: 1,
    state: PrStates.OPEN,
    repoSlug: "acme/unclaimed",
  });
  const gen = createGenerationProjection(handle, ctx);
  const target = makeBriefTarget(pr.id, "a".repeat(40));
  const row = await gen.upsertPending(target);

  async function stage(assignments: string): Promise<void> {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      await pool.query(`update generation set ${assignments} where id = $1`, [
        row.id,
      ]);
    } finally {
      await pool.end();
    }
  }
  return { handle, tenant, ctx, gen, target, stage };
}

describe.skipIf(databaseUrl === undefined)(
  "unclaimed generation writes on real Postgres",
  () => {
    async function runInUnclaimedWorld(
      test: (world: UnclaimedWorld) => Promise<void>,
    ): Promise<void> {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      const world = await openWorld(databaseUrl);
      try {
        await test(world);
      } finally {
        await deleteTenantRows(world.handle, world.tenant);
      }
    }

    it("settle refuses a row re-projected by a tx open at pickup", async () => {
      await runInUnclaimedWorld(async ({ handle, ctx, gen, target, stage }) => {
        await stage("status = 'failed', error_code = 'unknown'");
        let markResetOpen: () => void = () => undefined;
        const resetOpen = new Promise<void>((resolve) => {
          markResetOpen = resolve;
        });
        let releaseReset: () => void = () => undefined;
        const pickupRead = new Promise<void>((resolve) => {
          releaseReset = resolve;
        });
        const reset = internal(handle).transaction(async (tx) => {
          await tx.execute(sql`select 1`);
          markResetOpen();
          await pickupRead;
          const lagging = new Date(Date.now() - WRITER_CLOCK_LAG_MS);
          vi.useFakeTimers({ toFake: ["Date"], now: lagging });
          try {
            await projectPendingGeneration(tx, resolveScope(ctx), target);
          } finally {
            vi.useRealTimers();
          }
        });
        await resetOpen;

        const pickedUpAt = await gen.readClock();
        releaseReset();
        await reset;

        expect(await gen.settleStoredBrief(target, pickedUpAt)).toBeUndefined();
        expect((await gen.get(target))?.status).toBe(
          GenerationStatuses.PENDING,
        );
      });
    });
  },
);
