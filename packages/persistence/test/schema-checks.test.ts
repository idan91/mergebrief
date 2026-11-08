// The drizzle schema is the readable truth for CHECK constraints: a database
// built from the schema alone holds exactly the CHECKs the migrations create.
import type { PGlite } from "@electric-sql/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createTenantRepository,
} from "../src/index";
import {
  apiToken,
  auditLog,
  authSession,
  brief,
  checkpoint,
  chunkLayout,
  comparisonMarks,
  delta,
  disposition,
  generation,
  generationAttempt,
  generationPart,
  githubGrant,
  hunkSpan,
  inboxArchive,
  instanceVersion,
  pullRequest,
  revisionNarrative,
  reviewDraftComment,
  reviewGroupReclassification,
  reviewReadMark,
  reviewSession,
  reviewSubmittedReview,
  userSettings,
  webhookDelivery,
} from "../src/schema";
import { isInstallationId, isRepoId } from "../src/types";
import { PrStates } from "types/pull-requests";
import {
  brandWith,
  freshPglite,
  makeBriefTarget,
  MIGRATION_REPLAY_TIMEOUT_MS,
  registerSharedPglite,
  STALE_RUN_ID,
  virginPglite,
} from "./helpers";

const SCHEMA_TABLES = {
  apiToken,
  auditLog,
  authSession,
  brief,
  checkpoint,
  chunkLayout,
  comparisonMarks,
  delta,
  disposition,
  generation,
  generationAttempt,
  generationPart,
  githubGrant,
  hunkSpan,
  inboxArchive,
  instanceVersion,
  pullRequest,
  revisionNarrative,
  reviewDraftComment,
  reviewGroupReclassification,
  reviewReadMark,
  reviewSession,
  reviewSubmittedReview,
  userSettings,
  webhookDelivery,
};

const ARRAY_LITERAL = /ARRAY\[([^\]]*)\]/g;

/** `table.constraint` to its definition, array members sorted: order is not meaning. */
async function readCheckConstraints(
  client: PGlite,
): Promise<Record<string, string>> {
  const result = await client.query<{
    table: string;
    name: string;
    definition: string;
  }>(
    `select cl.relname as table, co.conname as name,
            pg_get_constraintdef(co.oid) as definition
       from pg_constraint co
       join pg_class cl on cl.oid = co.conrelid
       join pg_namespace ns on ns.oid = cl.relnamespace
      where co.contype = 'c' and ns.nspname = 'public'`,
  );
  const constraints: Record<string, string> = {};
  for (const row of result.rows) {
    constraints[`${row.table}.${row.name}`] = sortArrayMembers(row.definition);
  }
  return constraints;
}

function sortArrayMembers(definition: string): string {
  return definition.replace(ARRAY_LITERAL, (_match, members: string) => {
    const sorted = members.split(", ").toSorted().join(", ");
    return `ARRAY[${sorted}]`;
  });
}

async function buildDatabaseFromSchema(): Promise<PGlite> {
  const client = await virginPglite();
  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(SCHEMA_TABLES),
  );
  for (const statement of statements) {
    await client.exec(statement);
  }
  return client;
}

describe(
  "schema CHECK constraints",
  { timeout: MIGRATION_REPLAY_TIMEOUT_MS },
  () => {
    it("declares every migrated CHECK with the same definition", async () => {
      const migrated = await readCheckConstraints(await freshPglite());
      const declared = await readCheckConstraints(
        await buildDatabaseFromSchema(),
      );

      expect(declared).toEqual(migrated);
    });
  },
);

describe("generation lifecycle CHECKs", () => {
  const shared = registerSharedPglite();
  const ctx = { installationId: brandWith(isInstallationId, 1000n) };

  async function seedPendingRow(): Promise<void> {
    const { harness } = shared;
    const pr = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.upsert({
      repoId: brandWith(isRepoId, 777n),
      prNumber: 7,
      state: PrStates.OPEN,
    });
    await createGenerationProjection(harness.handle, ctx).upsertPending(
      makeBriefTarget(pr.id, "head"),
    );
  }

  it("refuses a failed row with no error code", async () => {
    await seedPendingRow();

    await expect(
      shared.harness.raw("update generation set status = 'failed'"),
    ).rejects.toThrow("generation_failed_has_code");
  });

  it("refuses a claim without a lease and a lease without a claim", async () => {
    await seedPendingRow();

    await expect(
      shared.harness.raw(
        "update generation set status = 'running', run_id = $1",
        [STALE_RUN_ID],
      ),
    ).rejects.toThrow("generation_claim_has_lease");
    await expect(
      shared.harness.raw("update generation set lease_expires_at = now()"),
    ).rejects.toThrow("generation_claim_has_lease");
  });

  it("refuses a claim on a row that is not running", async () => {
    await seedPendingRow();

    await expect(
      shared.harness.raw(
        "update generation set run_id = $1, lease_expires_at = now()",
        [STALE_RUN_ID],
      ),
    ).rejects.toThrow("generation_claim_is_running");
  });
});
