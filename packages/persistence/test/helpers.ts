// Shared PGlite test setup for this package's suites. Boots a fresh in-memory
// instance from the process's migrated snapshot (`src/pglite-snapshot`) and
// wraps it as the opaque `AppDatabase` the repository consumes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expect, onTestFinished } from "vitest";
import { type AppDatabase, fromDrizzle } from "../src/db/handle";
import { createMigratedPglite } from "../src/pglite-snapshot";
import * as schema from "../src/schema/index";
import { GenerationKinds, type PullRequestRowId } from "../src/types";

/**
 * A migrated, isolated PGlite that closes itself when the test ends.
 *
 * The close is critical, not hygiene: a live instance pins ~215MB of WASM
 * heap that V8 never reclaims on its own, so one leaked instance per test
 * walks the suite into swap and produces unrelated timeouts. Registering the
 * cleanup here rather than in each suite means no caller can forget it.
 */
export async function freshPglite(): Promise<PGlite> {
  const client = await createMigratedPglite();
  onTestFinished(async () => {
    if (!client.closed) await client.close();
  });
  return client;
}

/** A migrated, isolated database wrapped as the opaque handle. */
export async function freshDatabase(): Promise<AppDatabase> {
  return fromDrizzle(drizzle(await freshPglite(), { schema }));
}

/** Brand a bigint via its guard, the sanctioned no-`as` path. */
export function brandWith<T extends bigint>(
  guard: (value: bigint) => value is T,
  value: bigint,
): T {
  if (!guard(value)) {
    throw new Error(`test fixture id failed its brand guard: ${value}`);
  }
  return value;
}

/** Walk the `cause` chain for a Postgres error naming the given constraint. */
export async function expectCheckViolation(
  run: Promise<unknown>,
  constraint: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await run;
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected a rejection naming ${constraint}`).toBeDefined();
  let current: unknown = thrown;
  let found = false;
  while (current instanceof Error) {
    if (current.message.includes(constraint)) {
      found = true;
      break;
    }
    current = current.cause;
  }
  expect(found, `no error in the cause chain names ${constraint}`).toBe(true);
}

/** The brief-kind projection target for one head: the natural key with a null baseline. */
export function makeBriefTarget(
  pullRequestId: PullRequestRowId,
  headSha: string,
) {
  return {
    pullRequestId,
    kind: GenerationKinds.BRIEF,
    headSha,
    baselineSha: null,
  } as const;
}

/** The literals a CHECK constraint accepts. */
export async function readCheckValues(
  client: PGlite,
  constraintName: string,
): Promise<string[]> {
  const result = await client.query<{ def: string }>(
    "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
    [constraintName],
  );
  const def = result.rows[0]?.def;
  if (def === undefined) {
    throw new Error(`constraint ${constraintName} not found`);
  }
  return [...def.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? "");
}

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Every checked-in migration file, in journal order. */
export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .toSorted((a, b) => a.localeCompare(b));
}

/** Apply one migration file raw; the statement-breakpoint markers are comments. */
export async function applyMigrationFile(
  client: PGlite,
  name: string,
): Promise<void> {
  await client.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
}

/** A virgin PGlite, NO migrations applied, no drizzle ledger; closes with the test. */
export async function virginPglite(): Promise<PGlite> {
  const client = new PGlite();
  onTestFinished(async () => {
    if (!client.closed) await client.close();
  });
  return client;
}

/**
 * A PGlite migrated up to, not including, the migration whose file name
 * starts with `prefix`; the data test then seeds pre-migration rows and
 * applies the target itself.
 */
export async function pgliteBefore(
  prefix: string,
): Promise<{ client: PGlite; target: string }> {
  const client = await virginPglite();
  const files = listMigrationFiles();
  const target = files.find((name) => name.startsWith(prefix));
  if (target === undefined)
    throw new Error(`${prefix} migration file not found`);
  for (const name of files) {
    if (name === target) break;
    await applyMigrationFile(client, name);
  }
  return { client, target };
}
