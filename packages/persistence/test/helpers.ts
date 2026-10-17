// Shared PGlite test setup for this package's suites. Boots a fresh in-memory
// instance from the process's migrated snapshot
// (`src/testing/pglite-snapshot`) and wraps it as the opaque `AppDatabase` the
// repository consumes; the real-Postgres suites share the tenant fixture below.
import { randomInt } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { expect, onTestFinished } from "vitest";
import { type AppDatabase, fromDrizzle, internal } from "../src/db/handle";
import {
  closeDb,
  createDb,
  ensureAppSchema,
  type GenerationTarget,
  type TenantContext,
} from "../src/index";
import { createMigratedPglite } from "../src/testing/pglite-snapshot";
import type { PgliteHarness } from "../src/testing";
import { generation } from "../src/schema/generation";
import { generationAttempt } from "../src/schema/generation-attempt";
import { pullRequest } from "../src/schema/pull-request";
import {
  GenerationKinds,
  isInstallationId,
  isRepoId,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
} from "../src/types";

const TEST_POSTGRES_URL_VARIABLE = "MERGEBRIEF_TEST_POSTGRES_URL";
/** Far above any real GitHub installation id, so a fixture never meets one. */
const SMALLEST_FIXTURE_ID = 1_000_000_000_000;
/** The widest span `randomInt` draws from; the top stays a safe integer. */
const FIXTURE_ID_SPAN = 2 ** 48 - 1;

export type TestPostgresUrl = string | undefined;
export type WaitOutcome = "timer";

export interface TenantFixture {
  readonly tenant: InstallationId;
  readonly repoId: RepoId;
  readonly ctx: TenantContext;
}

/**
 * The real-Postgres URL for the suites PGlite cannot exercise. Unset locally
 * means skip; unset under CI throws, so a skip there cannot pass unseen.
 */
export function readTestPostgresUrl(
  env: Readonly<Record<string, string | undefined>>,
): TestPostgresUrl {
  const url = env[TEST_POSTGRES_URL_VARIABLE];
  if (url !== undefined && url !== "") {
    return url;
  }

  const ci = env["CI"];
  if (ci !== undefined && ci !== "") {
    throw new Error(
      `${TEST_POSTGRES_URL_VARIABLE} is unset under CI; the real-Postgres suites would skip`,
    );
  }
  return undefined;
}

/**
 * A tenant and repo id drawn at random, so suites in parallel workers on one
 * shared database never upsert, or clean up, each other's rows.
 */
export function makeFixture(): TenantFixture {
  const drawn = randomInt(
    SMALLEST_FIXTURE_ID,
    SMALLEST_FIXTURE_ID + FIXTURE_ID_SPAN,
  );
  const stamp = BigInt(drawn);
  const tenant: InstallationId = brandWith(isInstallationId, stamp);
  return {
    tenant,
    repoId: brandWith(isRepoId, stamp),
    ctx: { installationId: tenant },
  };
}

/** Migrate the real database at `url`, then open a pooled handle on it. */
export async function connectMigrated(url: string): Promise<AppDatabase> {
  const ensured = await ensureAppSchema(url, { autoMigrate: true });
  if (!ensured.ok) {
    throw new Error(ensured.error.message);
  }
  return createDb(url);
}

/** Delete the fixture tenant's own rows, then close the handle. */
export async function deleteTenantRows(
  handle: AppDatabase,
  tenant: InstallationId,
): Promise<void> {
  const db = internal(handle);
  await db
    .delete(generationAttempt)
    .where(eq(generationAttempt.installationId, tenant));
  await db.delete(generation).where(eq(generation.installationId, tenant));
  await db.delete(pullRequest).where(eq(pullRequest.installationId, tenant));
  await closeDb(handle);
}

export function waitMs(ms: number): Promise<WaitOutcome> {
  return new Promise((resolve) => setTimeout(() => resolve("timer"), ms));
}

/** Stamp one projection row's `updated_at`, picked by its natural key. */
export async function writeGenerationUpdatedAt(
  handle: AppDatabase,
  target: Pick<GenerationTarget, "pullRequestId" | "kind" | "headSha">,
  at: Date,
): Promise<void> {
  const naturalKey = and(
    eq(generation.pullRequestId, target.pullRequestId),
    eq(generation.kind, target.kind),
    eq(generation.headSha, target.headSha),
  );

  await internal(handle)
    .update(generation)
    .set({ updatedAt: at })
    .where(naturalKey);
}

/** Stamp every queued job's `run_at`, so a later trigger that moved it shows. */
export async function writeJobRunAt(
  harness: PgliteHarness,
  at: Date,
): Promise<void> {
  await harness.raw("update graphile_worker.jobs set run_at = $1", [
    at.toISOString(),
  ]);
}

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
    if (!client.closed) {
      await client.close();
    }
  });
  return client;
}

/** A migrated, isolated database wrapped as the opaque handle. */
export async function freshDatabase(): Promise<AppDatabase> {
  return fromDrizzle(drizzle(await freshPglite()));
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
    if (!client.closed) {
      await client.close();
    }
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
  if (target === undefined) {
    throw new Error(`${prefix} migration file not found`);
  }
  for (const name of files) {
    if (name === target) {
      break;
    }
    await applyMigrationFile(client, name);
  }
  return { client, target };
}
