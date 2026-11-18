// The bot hold against a Generate approval in flight, on a real Postgres named
// by MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
// PGlite runs one connection, so the approval's open transaction cannot be
// staged there.
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createTenantRepository,
  GenerationErrorCodes,
} from "../src/index";
import { readTestPostgresUrl } from "../src/testing";
import { GenerationStatuses, PrStates } from "types";
import {
  connectMigrated,
  deleteTenantRows,
  makeBriefTarget,
  makeFixture,
  waitMs,
} from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
const LOCK_POLL_MS = 20;
const LOCK_WAIT_LIMIT_MS = 5000;
const APPROVER_ID = 31337;

/** Resolves once another session waits on a lock over the pull_request row. */
async function waitForPullRequestLockWaiter(observer: PoolClient) {
  for (let waited = 0; waited < LOCK_WAIT_LIMIT_MS; waited += LOCK_POLL_MS) {
    const waiting = await observer.query(
      `select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like '%"pull_request"%' and datname = current_database()`,
    );
    if (waiting.rowCount !== null && waiting.rowCount > 0) {
      return;
    }
    await waitMs(LOCK_POLL_MS);
  }
  throw new Error("the hold never waited on the pull request's row lock");
}

describe.skipIf(databaseUrl === undefined)(
  "markAwaitingTrigger beside an approval on real Postgres",
  () => {
    it("waits out an approval holding the PR row, then refuses", async () => {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      const { tenant, repoId, ctx } = makeFixture();
      const handle = await connectMigrated(databaseUrl);
      const pool = new Pool({ connectionString: databaseUrl, max: 2 });
      const approving = await pool.connect();
      const observer = await pool.connect();

      try {
        const pr = await createTenantRepository(
          handle,
          ctx,
        ).pullRequests.upsert({
          repoId,
          prNumber: 1,
          state: PrStates.OPEN,
          repoSlug: "acme/hold",
        });
        const gen = createGenerationProjection(handle, ctx);
        const target = makeBriefTarget(pr.id, "a".repeat(40));
        await gen.upsertPending(target);

        await approving.query("begin");
        await approving.query(
          "select id from pull_request where id = $1 for update",
          [pr.id],
        );
        await approving.query(
          "update generation set status = 'pending' where pull_request_id = $1",
          [pr.id],
        );
        const holding = gen.markAwaitingTrigger(target);
        await waitForPullRequestLockWaiter(observer);
        await approving.query(
          "update pull_request set trigger_approved_by = $2, trigger_approved_at = now() where id = $1",
          [pr.id, APPROVER_ID],
        );
        await approving.query("commit");

        const held = await holding;
        expect(!held.ok && held.error.code).toBe(
          GenerationErrorCodes.TRIGGER_APPROVED,
        );
        const row = await gen.get(target);
        expect(row?.status).toBe(GenerationStatuses.PENDING);
      } finally {
        approving.release();
        observer.release();
        await pool.end();
        await deleteTenantRows(handle, tenant);
      }
    });
  },
);
