// The instance cap lock behind `claimUnits` cannot be proven on PGlite, which
// runs one connection. This suite runs only against a real Postgres named by
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
// Each test seeds its runs' attempt rows on a day far past every other
// suite's window, so the unscoped daily count sees only this test's units.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  ChargeOutcomes,
  createGenerationProjection,
  createTenantRepository,
  type GenerationProjection,
  type TenantContext,
  type UtcDay,
  utcDayBounds,
} from "../src/index";
import { internal, type AppDatabase } from "../src/db/handle";
import { generation } from "../src/schema/generation";
import { generationAttempt } from "../src/schema/generation-attempt";
import type { InstallationId, RepoId } from "../src/types";
import { PrStates } from "types/pull-requests";
import {
  connectMigrated,
  deleteTenantRows,
  makeBriefTarget,
  makeFixture,
  waitMs,
} from "./helpers";
import { readTestPostgresUrl } from "../src/testing";

const databaseUrl = readTestPostgresUrl(process.env);
const HOLD_MS = 300;
const RACE_DAY = utcDayBounds(new Date("2150-03-14T12:00:00Z"));
const HELD_DAY = utcDayBounds(new Date("2150-03-15T12:00:00Z"));

interface SeededRuns {
  readonly projection: GenerationProjection;
  readonly runIds: string[];
}

interface RunSeed {
  readonly tenant: InstallationId;
  readonly repoId: RepoId;
  readonly ctx: TenantContext;
  readonly heads: readonly string[];
  readonly day: UtcDay;
}

/** One pending head per name, each with a one-unit attempt row started on `day`. */
async function seedRuns(
  handle: AppDatabase,
  seed: RunSeed,
): Promise<SeededRuns> {
  const pr = await createTenantRepository(handle, seed.ctx).pullRequests.upsert(
    {
      repoId: seed.repoId,
      prNumber: 1,
      state: PrStates.OPEN,
      repoSlug: "acme/units-lock",
    },
  );
  const projection = createGenerationProjection(handle, seed.ctx);
  const runIds: string[] = [];
  for (const head of seed.heads) {
    await projection.upsertPending(makeBriefTarget(pr.id, head));
    const rows = await internal(handle)
      .select({ id: generation.id })
      .from(generation)
      .where(
        and(
          eq(generation.installationId, seed.tenant),
          eq(generation.headSha, head),
        ),
      );
    const generationId = rows[0]?.id;
    if (generationId === undefined) {
      throw new Error(`expected a generation row for ${head}`);
    }
    const runId = randomUUID();
    await internal(handle).insert(generationAttempt).values({
      installationId: seed.tenant,
      runId,
      generationId,
      startedAt: seed.day.from,
    });
    runIds.push(runId);
  }
  return { projection, runIds };
}

describe.skipIf(databaseUrl === undefined)(
  "claimUnits on real Postgres",
  () => {
    it("two parallel unit claims at the cap book only the one that fits", async () => {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      const { tenant, repoId, ctx } = makeFixture();
      const handle = await connectMigrated(databaseUrl);

      try {
        const { projection, runIds } = await seedRuns(handle, {
          tenant,
          repoId,
          ctx,
          heads: ["one", "two"],
          day: RACE_DAY,
        });

        const outcomes = await Promise.all(
          runIds.map((runId) =>
            projection.claimUnits({
              runId,
              units: 6,
              cap: 10,
              ...RACE_DAY,
            }),
          ),
        );

        const kinds = outcomes.map(
          (outcome) => outcome.ok && outcome.value.kind,
        );
        expect(
          kinds.filter((kind) => kind === ChargeOutcomes.CHARGED),
        ).toHaveLength(1);
        const refused = outcomes.find(
          (outcome) =>
            outcome.ok && outcome.value.kind === ChargeOutcomes.CAPPED,
        );
        expect(refused?.ok && refused.value).toEqual({
          kind: ChargeOutcomes.CAPPED,
          needed: 6,
          left: 2,
          cap: 10,
        });
        expect(await projection.countStartedRuns(RACE_DAY)).toBe(8);
      } finally {
        await deleteTenantRows(handle, tenant);
      }
    });

    it("a unit claim waits on the instance cap lock while another holds it", async () => {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      const { tenant, repoId, ctx } = makeFixture();
      const handle = await connectMigrated(databaseUrl);
      const holder = new Pool({ connectionString: databaseUrl, max: 1 });
      const holding = await holder.connect();

      try {
        const { projection, runIds } = await seedRuns(handle, {
          tenant,
          repoId,
          ctx,
          heads: ["held"],
          day: HELD_DAY,
        });
        const [runId] = runIds;
        if (runId === undefined) {
          throw new Error("expected a run");
        }
        await holding.query("begin");
        await holding.query("select pg_advisory_xact_lock(hashtext($1))", [
          "generation-cap",
        ]);

        const start = projection.claimUnits({
          runId,
          units: 2,
          cap: 10,
          ...HELD_DAY,
        });
        const whileHeld = await Promise.race([start, waitMs(HOLD_MS)]);
        await holding.query("commit");
        const released = await start;

        expect(whileHeld).toBe("timer");
        expect(released).toEqual({
          ok: true,
          value: { kind: ChargeOutcomes.CHARGED },
        });
      } finally {
        holding.release();
        await holder.end();
        await deleteTenantRows(handle, tenant);
      }
    });
  },
);
