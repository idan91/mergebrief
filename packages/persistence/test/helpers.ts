// Shared PGlite test setup for this package's suites. Boots a fresh in-memory
// instance from the process's migrated snapshot
// (`src/testing/pglite-snapshot`) and wraps it as the opaque `AppDatabase` the
// repository consumes; the real-Postgres suites share the tenant fixture below.
import { randomBytes, randomInt } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  onTestFinished,
} from "vitest";
import { createEnvKeyProvider, type KeyProvider } from "../src/auth/crypto";
import type { GithubGrantRow } from "../src/auth/grant";
import { type AppDatabase, fromDrizzle, internal } from "../src/db/handle";
import {
  closeDb,
  createDb,
  ensureAppSchema,
  type GenerationTarget,
  type TenantContext,
} from "../src/index";
import { parseTenantContext } from "../src/stores/scope-context";
import { createTenantRepository } from "../src/stores/tenant";
import { createMigratedPglite } from "../src/testing/pglite-snapshot";
import { seedGrant } from "../src/testing/seed-grant";
import {
  createPgliteHarness,
  type PgliteHarness,
  resetPgliteHarness,
} from "../src/testing";
import { generation } from "../src/schema/generation";
import { generationAttempt } from "../src/schema/generation-attempt";
import { pullRequest } from "../src/schema/pull-request";
import {
  GenerationKinds,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../src/types";

/** Far above any real GitHub installation id, so a fixture never meets one. */
const SMALLEST_FIXTURE_ID = 1_000_000_000_000;
/** The widest span `randomInt` draws from; the top stays a safe integer. */
const FIXTURE_ID_SPAN = 2 ** 48 - 1;

export type WaitOutcome = "timer";

export interface TenantFixture {
  readonly tenant: InstallationId;
  readonly repoId: RepoId;
  readonly ctx: TenantContext;
}

/**
 * A tenant and repo id drawn at random, so suites in parallel workers on one
 * shared database never upsert, or clean up, each other's rows.
 */
export function makeFixture(): TenantFixture {
  const stamp = drawFixtureId();
  const tenant: InstallationId = brandWith(isInstallationId, stamp);
  return {
    tenant,
    repoId: brandWith(isRepoId, stamp),
    ctx: { installationId: tenant },
  };
}

/**
 * A reviewer drawn at random, so credential suites in parallel workers never
 * lock, delete or sweep each other's sessions, tokens and grants.
 */
export function makeFixtureReviewer(): ReviewerId {
  return brandWith(isReviewerId, drawFixtureId());
}

function drawFixtureId(): bigint {
  const drawn = randomInt(
    SMALLEST_FIXTURE_ID,
    SMALLEST_FIXTURE_ID + FIXTURE_ID_SPAN,
  );
  return BigInt(drawn);
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

export async function writeGenerationTriggeredAt(
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
    .set({ triggeredAt: at })
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

export interface SharedPglite {
  /** The file's one instance, at its post-migration state when a test starts. */
  readonly client: PGlite;
  readonly handle: AppDatabase;
  readonly harness: PgliteHarness;
  /** A drizzle over the same instance, for raw reads the handle hides. */
  readonly db: PgliteDatabase;
}

/**
 * One migrated PGlite for the whole file, graphile stub included: opened and
 * its baseline recorded before the first test, reset before each, closed
 * after the last. Register at module scope or inside a describe; the fields
 * resolve only inside a test.
 */
export function registerSharedPglite(): SharedPglite {
  let harness: PgliteHarness | undefined;
  function requireHarness(): PgliteHarness {
    if (harness === undefined) {
      throw new Error("the shared PGlite is open only while a test runs");
    }
    return harness;
  }

  beforeAll(async () => {
    harness = await createPgliteHarness();
    await resetPgliteHarness(harness);
  });
  beforeEach(async () => {
    await resetPgliteHarness(requireHarness());
  });
  afterAll(async () => {
    await harness?.close();
    harness = undefined;
  });

  return {
    get client() {
      return requireHarness().database;
    },
    get handle() {
      return requireHarness().handle;
    },
    get harness() {
      return requireHarness();
    },
    get db() {
      return drizzle(requireHarness().database);
    },
  };
}

export interface QueryLog {
  readonly handle: AppDatabase;
  /** Every statement drizzle ran; `begin`, `commit` and `rollback` mark each transaction. */
  readonly statements: string[];
}

/** A fresh database whose every statement lands in `statements`, for query-shape tests. */
export async function createQueryLog(): Promise<QueryLog> {
  const statements: string[] = [];
  const db = drizzle(await freshPglite(), {
    logger: {
      logQuery(query) {
        statements.push(query);
      },
    },
  });
  const runTransaction = db.transaction.bind(db);
  db.transaction = async (transaction, config) => {
    statements.push("begin");
    try {
      const result = await runTransaction(transaction, config);
      statements.push("commit");
      return result;
    } catch (error) {
      statements.push("rollback");
      throw error;
    }
  };
  return { handle: fromDrizzle(db), statements };
}

export interface RecordedRun<TValue> {
  /** The statements `run` issued, in order. */
  readonly statements: string[];
  readonly outcome: PromiseSettledResult<TValue>;
}

/** Runs `run` and records its statements; a rejection lands in `outcome` for the caller to assert. */
export async function recordStatements<TValue>(
  log: QueryLog,
  run: () => Promise<TValue>,
): Promise<RecordedRun<TValue>> {
  const from = log.statements.length;
  const [outcome] = await Promise.allSettled([run()]);
  return { statements: log.statements.slice(from), outcome };
}

/** Brand a value via its guard, the sanctioned no-`as` path. */
export function brandWith<Base extends bigint | string, Branded extends Base>(
  guard: (value: Base) => value is Branded,
  value: Base,
): Branded {
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

/** A test that replays the migrations itself outgrows the 5 s default under a parallel run. */
export const MIGRATION_REPLAY_TIMEOUT_MS = 30_000;

export const TEST_KEY_REF = "SESSION_KEY_V1";
export const TEST_KEY_PROVIDER: KeyProvider = createEnvKeyProvider({
  [TEST_KEY_REF]: randomBytes(32).toString("base64"),
});
const GRANT_REFRESH_EXPIRY = new Date("2027-01-01T00:00:00Z");

/** A grant for `userId` holding a sealed throwaway pair, as a sign-in leaves one. */
export async function makeGrant(
  handle: AppDatabase,
  userId: ReviewerId,
  refreshExpiresAt: Date = GRANT_REFRESH_EXPIRY,
): Promise<GithubGrantRow> {
  return seedGrant(handle, {
    userId,
    accessToken: "ghu_test-access",
    refreshToken: "ghr_test-refresh",
    keyProvider: TEST_KEY_PROVIDER,
    keyRef: TEST_KEY_REF,
    refreshExpiresAt,
  });
}

/** The tenant, repository, approver and head the trigger-approval suites seed. */
export const GATE_CTX = parseTenantContext({ installationId: 100n });
export const GATE_REPO_ID = brandWith(isRepoId, 200n);
export const GATE_REVIEWER = brandWith(isReviewerId, 31337n);
export const GATE_HEAD_SHA = "ec26c3e57ca3a959ca5aad62de7213c562f8c821";

/** The gate suites' approver records a Trigger approval on the pull request. */
export async function approveGatedPullRequest(
  shared: SharedPglite,
  pullRequestId: PullRequestRowId,
): Promise<void> {
  const { pullRequests } = createTenantRepository(shared.handle, GATE_CTX);
  await pullRequests.approveTrigger(pullRequestId, GATE_REVIEWER);
}

/** Every graphile job queued so far, whatever its task. */
export async function countQueuedJobs(shared: SharedPglite): Promise<number> {
  const jobs = await shared.harness.raw("select id from graphile_worker.jobs");
  return jobs.length;
}
