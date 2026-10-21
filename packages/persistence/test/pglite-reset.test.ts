// The reset contract: after `resetPgliteHarness`, a shared instance holds
// exactly what a fresh one does: every discovered table at its post-migration
// rows, seeded rows kept, every sequence back at its position.
import { describe, expect, it, onTestFinished } from "vitest";
import { createTenantRepository, type TenantContext } from "../src/index";
import {
  createPgliteHarness,
  type PgliteHarness,
  type PgliteHarnessOptions,
  resetPgliteHarness,
} from "../src/testing";
import { isInstallationId, isRepoId, type RepoId } from "../src/types";
import { PrStates } from "types/pull-requests";
import { brandWith } from "./helpers";

const CTX: TenantContext = { installationId: brandWith(isInstallationId, 1n) };
const REPO: RepoId = brandWith(isRepoId, 7n);

interface TableCount {
  readonly name: string;
  readonly count: number;
}

/** A harness that closes with the test, its baseline already recorded. */
async function openHarness(
  options?: PgliteHarnessOptions,
): Promise<PgliteHarness> {
  const harness = await createPgliteHarness(options);
  onTestFinished(() => harness.close());
  await resetPgliteHarness(harness);
  return harness;
}

async function countEveryTable(harness: PgliteHarness): Promise<TableCount[]> {
  const tables = await harness.raw(
    "select format('%I.%I', schemaname, tablename) as name from pg_tables " +
      "where schemaname in ('public', 'graphile_worker') order by 1",
  );
  return Promise.all(
    tables.map(async (table) => {
      const name = String(table["name"]);
      const counted = await harness.raw(
        `select count(*)::int as count from ${name}`,
      );
      return { name, count: Number(counted[0]?.["count"]) };
    }),
  );
}

async function addStubJob(harness: PgliteHarness): Promise<number> {
  const added = await harness.raw(
    "select id from graphile_worker.add_job('generate')",
  );
  return Number(added[0]?.["id"]);
}

async function upsertPullRequest(
  harness: PgliteHarness,
  prNumber: number,
): Promise<bigint> {
  const written = await createTenantRepository(
    harness.handle,
    CTX,
  ).pullRequests.upsert({ repoId: REPO, prNumber, state: PrStates.OPEN });
  return written.id;
}

async function readMigrationCount(harness: PgliteHarness): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as count from drizzle.__drizzle_migrations",
  );
  return Number(rows[0]?.["count"]);
}

describe("resetPgliteHarness", () => {
  it("returns every discovered table to its fresh count, ids restarted", async () => {
    const harness = await openHarness();
    const fresh = await countEveryTable(harness);
    const written = await upsertPullRequest(harness, 1);
    await harness.raw("insert into user_settings (gh_user_id) values (1)");
    await harness.raw(
      "insert into instance_version (id, version) values (true, '1.0.0')",
    );
    const firstJob = await addStubJob(harness);

    await resetPgliteHarness(harness);

    const counts = await countEveryTable(harness);
    expect(counts.length).toBeGreaterThan(20);
    expect(counts.map((table) => table.name)).toContain("graphile_worker.jobs");
    expect(counts).toEqual(fresh);
    expect(await upsertPullRequest(harness, 1)).toBe(written);
    expect(await addStubJob(harness)).toBe(firstJob);
  });

  it("leaves the drizzle migration journal alone", async () => {
    const harness = await openHarness();
    const before = await readMigrationCount(harness);

    await resetPgliteHarness(harness);

    expect(await readMigrationCount(harness)).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it("re-inserts the rows the baseline held after the truncate", async () => {
    const harness = await createPgliteHarness();
    onTestFinished(() => harness.close());
    await harness.raw("insert into user_settings (gh_user_id) values (42)");
    await harness.raw(
      "insert into instance_version (id, version) values (true, '0.9.0')",
    );
    await harness.raw("insert into user_settings (gh_user_id) values (43)");

    await resetPgliteHarness(harness);
    await harness.raw("insert into user_settings (gh_user_id) values (44)");
    await harness.raw("update instance_version set version = '2.0.0'");
    await resetPgliteHarness(harness);

    const settings = await harness.raw(
      "select gh_user_id from user_settings order by 1",
    );
    expect(settings.map((row) => Number(row["gh_user_id"]))).toEqual([42, 43]);
    const version = await harness.raw("select version from instance_version");
    expect(version[0]?.["version"]).toBe("0.9.0");
  });

  it("restores an identity column and its sequence past a baseline row", async () => {
    const harness = await createPgliteHarness();
    onTestFinished(() => harness.close());
    const seeded = await upsertPullRequest(harness, 1);
    const seededJob = await addStubJob(harness);

    await resetPgliteHarness(harness);
    await upsertPullRequest(harness, 2);
    await addStubJob(harness);
    await resetPgliteHarness(harness);

    const kept = await harness.raw("select id from pull_request order by id");
    expect(kept.map((row) => Number(row["id"]))).toEqual([Number(seeded)]);
    expect(await upsertPullRequest(harness, 3)).toBe(seeded + 1n);
    expect(await addStubJob(harness)).toBe(seededJob + 1);
  });

  it("discovers the tables that exist, stub schema or not", async () => {
    const harness = await openHarness({ graphileStub: false });
    await harness.raw("insert into user_settings (gh_user_id) values (1)");

    await resetPgliteHarness(harness);

    const counts = await countEveryTable(harness);
    expect(counts.map((table) => table.name)).not.toContain(
      "graphile_worker.jobs",
    );
    expect(counts.every((table) => table.count === 0)).toBe(true);
  });
});
