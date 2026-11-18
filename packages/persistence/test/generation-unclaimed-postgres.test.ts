// The status guards on unclaimed generation writes, on a real Postgres named
// by MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
// Rows are staged by raw updates, never a claim: an attempt row would count
// against the instance-wide cap the generation-cap suite asserts in parallel.
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  createGenerationProjection,
  createTenantRepository,
  GenerationErrorCodes,
  type GenerationProjection,
} from "../src/index";
import { readTestPostgresUrl } from "../src/testing";
import { internal, type AppDatabase } from "../src/db/handle";
import { projectPendingGeneration } from "../src/stores/generation";
import { resolveScope } from "../src/stores/scope";
import type { TenantContext } from "../src/stores/scope-context";
import type { InstallationId } from "../src/types";
import { GenerationFailureCodes, GenerationStatuses, PrStates } from "types";
import {
  connectMigrated,
  deleteTenantRows,
  makeBriefTarget,
  makeFixture,
} from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
/** How far an api host's clock may lag the database's. */
const WRITER_CLOCK_LAG_MS = 60_000;
const FAILED_RUN = {
  status: GenerationStatuses.FAILED,
  failure: { code: GenerationFailureCodes.ATTEMPTS_EXHAUSTED },
} as const;

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

    it("ends a pending row a takeover handed back to recovery", async () => {
      await runInUnclaimedWorld(async ({ gen, target, stage }) => {
        await stage("claims = 1, awaits_recovery = true");

        const ended = await gen.endReleasedClaim(target, FAILED_RUN);

        expect(ended.ok && ended.value.status).toBe(GenerationStatuses.FAILED);
        expect(ended.ok && ended.value.awaitsRecovery).toBe(false);
      });
    });

    it("leaves a pending row a regular run's shutdown released", async () => {
      await runInUnclaimedWorld(async ({ gen, target, stage }) => {
        await stage("claims = 1");

        const ended = await gen.endReleasedClaim(target, FAILED_RUN);

        expect(!ended.ok && ended.error.code).toBe(
          GenerationErrorCodes.CLAIM_LOST,
        );
        expect((await gen.get(target))?.status).toBe(
          GenerationStatuses.PENDING,
        );
      });
    });

    it("a trigger clears a row's hand-back to recovery", async () => {
      await runInUnclaimedWorld(async ({ gen, target, stage }) => {
        await stage("claims = 1, awaits_recovery = true");

        await gen.upsertPending(target);

        const claim = await gen.readClaim(target);
        expect(claim?.awaitsRecovery).toBe(false);
        const ended = await gen.endReleasedClaim(target, FAILED_RUN);
        expect(!ended.ok && ended.error.code).toBe(
          GenerationErrorCodes.CLAIM_LOST,
        );
      });
    });

    it("leaves a pending row a trigger projected after the release", async () => {
      await runInUnclaimedWorld(async ({ gen, target }) => {
        const ended = await gen.endReleasedClaim(target, FAILED_RUN);

        expect(!ended.ok && ended.error.code).toBe(
          GenerationErrorCodes.CLAIM_LOST,
        );
        expect((await gen.get(target))?.status).toBe(
          GenerationStatuses.PENDING,
        );
      });
    });

    it.each([
      GenerationStatuses.AWAITING_TRIGGER,
      GenerationStatuses.SUCCEEDED,
    ])("unclaimed marks keep a %s row", async (status) => {
      await runInUnclaimedWorld(async ({ gen, target, stage }) => {
        await stage(`status = '${status}'`);

        const marks = [
          await gen.markFailed(target, FAILED_RUN.failure),
          await gen.markSuperseded(target),
          await gen.markCapped(target),
        ];

        expect(marks.map((mark) => !mark.ok && mark.error.code)).toEqual([
          GenerationErrorCodes.STATUS_KEPT,
          GenerationErrorCodes.STATUS_KEPT,
          GenerationErrorCodes.STATUS_KEPT,
        ]);
        expect((await gen.get(target))?.status).toBe(status);
      });
    });

    it("markFailed still fails a pending row", async () => {
      await runInUnclaimedWorld(async ({ gen, target }) => {
        const marked = await gen.markFailed(target, FAILED_RUN.failure);

        expect(marked.ok && marked.value.status).toBe(
          GenerationStatuses.FAILED,
        );
      });
    });
  },
);
