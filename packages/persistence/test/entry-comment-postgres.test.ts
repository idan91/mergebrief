// Two worker slots can both post an Entry comment inside one GitHub round
// trip; the swap must store exactly one id. PGlite runs one connection, so
// this suite runs only against a real Postgres named by
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
import { describe, expect, it } from "vitest";
import {
  createTenantRepository,
  EntryCommentSwapErrorCodes,
} from "../src/index";
import { readTestPostgresUrl } from "../src/testing";
import { PrStates } from "types/pull-requests";
import { connectMigrated, deleteTenantRows, makeFixture } from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
const RACING_RUNS = 8;
const FIRST_COMMENT_ID = 9_001n;

describe.skipIf(databaseUrl === undefined)(
  "swapEntryComment on real Postgres",
  () => {
    it("parallel swaps from one seen id store exactly one comment id", async () => {
      if (databaseUrl === undefined) {
        throw new Error("unreachable");
      }
      const { tenant, repoId, ctx } = makeFixture();
      const handle = await connectMigrated(databaseUrl);

      try {
        const pr = await createTenantRepository(
          handle,
          ctx,
        ).pullRequests.upsert({
          repoId,
          prNumber: 1,
          state: PrStates.OPEN,
          repoSlug: "acme/entry",
        });
        const postedIds = Array.from(
          { length: RACING_RUNS },
          (_, index) => FIRST_COMMENT_ID + BigInt(index),
        );

        const repo = createTenantRepository(handle, ctx);
        const racing = postedIds.map((next) =>
          repo.pullRequests.swapEntryComment(pr.id, { seen: null, next }),
        );
        const swaps = await Promise.all(racing);

        const won = swaps.flatMap((swap) => (swap.ok ? [swap.value] : []));
        expect(won).toHaveLength(1);
        const stored = await createTenantRepository(
          handle,
          ctx,
        ).pullRequests.getById(pr.id);
        expect(stored?.entryCommentId).toBe(won[0]?.entryCommentId);
        const lost = swaps.flatMap((swap) => (swap.ok ? [] : [swap.error]));
        expect(lost).toEqual(
          Array.from({ length: RACING_RUNS - 1 }, () => ({
            code: EntryCommentSwapErrorCodes.SWAP_LOST,
            entryCommentId: stored?.entryCommentId,
          })),
        );
      } finally {
        await deleteTenantRows(handle, tenant);
      }
    });
  },
);
