// The drizzle schema is the readable truth for CHECK constraints: a database
// built from the schema alone holds exactly the CHECKs the migrations create.
import type { PGlite } from "@electric-sql/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";
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
import {
  freshPglite,
  MIGRATION_REPLAY_TIMEOUT_MS,
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
