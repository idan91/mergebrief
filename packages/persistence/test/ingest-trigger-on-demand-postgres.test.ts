// A claim landing between a Trigger's head read and its upsert cannot be
// staged on PGlite, which runs one connection. This suite runs only against
// a real Postgres named by MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when
// unset, red under CI.
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  TriggerOnDemandOutcomes,
} from "../src/index";
import { readTestPostgresUrl } from "../src/testing";
import { GenerationFailureCodes, PrStates } from "types";
import {
  connectMigrated,
  deleteTenantRows,
  makeBriefTarget,
  makeFixture,
  waitMs,
} from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
const HOLD_MS = 300;
const LATE_RUN_ID = "00000000-0000-4000-8000-000000000001";

describe.skipIf(databaseUrl === undefined)(
  "triggerOnDemand on real Postgres",
  () => {
    it("answers held when a claim lands between its read and its upsert", async () => {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      const { tenant, repoId, ctx } = makeFixture();
      const handle = await connectMigrated(databaseUrl);
      const holder = new Pool({ connectionString: databaseUrl, max: 1 });
      const holding = await holder.connect();

      try {
        const pr = await createTenantRepository(
          handle,
          ctx,
        ).pullRequests.upsert({
          repoId,
          prNumber: 1,
          state: PrStates.OPEN,
          repoSlug: "acme/regenerate",
        });
        const gen = createGenerationProjection(handle, ctx);
        const target = makeBriefTarget(pr.id, "a".repeat(40));
        await gen.upsertPending(target);
        // No claim: an attempt row would count against the instance-wide cap
        // the generation-cap suite asserts in parallel on this database.
        await gen.markFailed(target, {
          code: GenerationFailureCodes.PROVIDER_TIMEOUT,
        });
        const failed = await gen.get(target);
        if (failed === undefined) {
          throw new Error("expected the failed head's row");
        }
        await holding.query("begin");
        await holding.query(
          "update generation set status = 'running', run_id = $1, lease_expires_at = now() + interval '2 minutes', claims = claims + 1 where id = $2",
          [LATE_RUN_ID, failed.id],
        );

        const triggering = createIngestRoutines(handle, ctx).triggerOnDemand({
          pullRequestId: pr.id,
        });
        const whileUncommitted = await Promise.race([
          triggering,
          waitMs(HOLD_MS),
        ]);
        await holding.query("commit");
        const outcome = await triggering;

        expect(whileUncommitted).toBe("timer");
        expect(outcome).toBe(TriggerOnDemandOutcomes.HELD);
        const after = await gen.get(target);
        expect(after?.runId).toBe(LATE_RUN_ID);
        expect(after?.claims).toBe(failed.claims + 1);
        expect(after?.triggeredAt).toEqual(failed.triggeredAt);
      } finally {
        holding.release();
        await holder.end();
        await deleteTenantRows(handle, tenant);
      }
    });
  },
);
