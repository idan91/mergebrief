// The scheduled pull request sweep against a real migrated schema (the
// `persistence/testing` PGlite harness). Rows are seeded through the tenant
// repository's own upsert, which is the only writer of a close time.
import { describe, expect, it } from "vitest";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import {
  createTenantRepository,
  isInstallationId,
  isRepoId,
  type InstallationId,
  type RepoId,
} from "persistence";
import { PrStates, type PrState } from "types/pull-requests";
import { createLogger, type Logger } from "logging";
import { createSweepPullRequestsTask } from "../src/task/sweep-pull-requests";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

function makeInstallationId(id: bigint): InstallationId {
  if (!isInstallationId(id)) {
    throw new Error("not an installation id");
  }
  return id;
}

function makeRepoId(id: bigint): RepoId {
  if (!isRepoId(id)) {
    throw new Error("not a repo id");
  }
  return id;
}

const TENANT = makeInstallationId(4001n);
const REPO = makeRepoId(99n);

function subtractDaysFromNow(days: number): Date {
  return new Date(Date.now() - days * MS_PER_DAY);
}

async function seedPullRequest(
  harness: PgliteHarness,
  prNumber: number,
  state: PrState,
  closedAt: Date,
): Promise<void> {
  const repository = createTenantRepository(harness.handle, {
    installationId: TENANT,
  });
  if (state === PrStates.OPEN) {
    await repository.pullRequests.upsert({ repoId: REPO, prNumber, state });
    return;
  }
  await repository.pullRequests.upsert({
    repoId: REPO,
    prNumber,
    state,
    closedAt,
  });
}

async function readPrNumbers(harness: PgliteHarness): Promise<unknown[]> {
  const rows = await harness.raw(
    "select pr_number from pull_request order by pr_number",
  );
  return rows.map((row) => row["pr_number"]);
}

function makeSilentLogger(): Logger {
  return createLogger({ env: { LOG_LEVEL: "error" } });
}

describe("sweep-pull-requests task", () => {
  it("deletes nothing when retention is unset", async () => {
    const harness = await createPgliteHarness();
    await seedPullRequest(
      harness,
      1,
      PrStates.CLOSED,
      subtractDaysFromNow(4000),
    );

    await createSweepPullRequestsTask({
      handle: harness.handle,
      retentionDays: null,
      log: makeSilentLogger(),
    })();

    expect(await readPrNumbers(harness)).toEqual([1]);
    await harness.close();
  });

  it("deletes rows closed past the window and keeps open and recent ones", async () => {
    const harness = await createPgliteHarness();
    await seedPullRequest(harness, 1, PrStates.CLOSED, subtractDaysFromNow(40));
    await seedPullRequest(harness, 2, PrStates.MERGED, subtractDaysFromNow(31));
    await seedPullRequest(harness, 3, PrStates.MERGED, subtractDaysFromNow(10));
    await seedPullRequest(harness, 4, PrStates.OPEN, subtractDaysFromNow(40));

    await createSweepPullRequestsTask({
      handle: harness.handle,
      retentionDays: RETENTION_DAYS,
      log: makeSilentLogger(),
    })();

    expect(await readPrNumbers(harness)).toEqual([3, 4]);
    const audits = await harness.raw(
      "select operation, actor_type, metadata from audit_log",
    );
    expect(audits).toEqual([
      { operation: "delete", actor_type: "system", metadata: { count: 2 } },
    ]);
    await harness.close();
  });
});
