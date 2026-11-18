// A run's pool is decided before its claim from the PR read: a normal-pool
// job the counts predict multi-call moves to the large pool with nothing
// claimed; the large pool's job runs whatever it was given.
import type { FakeGitHub } from "github/testing";
import { createI18n } from "i18n";
import { createGenerationProjection } from "persistence";
import { claimTestRun } from "persistence/testing";
import { RepoConfigPaths } from "repo-config";
import { GenerationStatuses } from "types/generations";
import { describe, expect, it } from "vitest";
import { buildEntryCommentOnDemandBody } from "../../src/task/entry-comment";
import {
  buildRepoFile,
  captureLogger,
  ctx,
  ENTRY_PR_VIEW,
  FIRST_BRIEF_INDEX,
  harness,
  HEAD_1,
  makeGitHub,
  makeLargePoolTask,
  makeRecoveryTask,
  makeTarget,
  makeTask,
  PR_REF,
  readLiveBodies,
  readRowStatus,
  REPO,
  setUpHarness,
  stubGenerator,
  trigger,
} from "./helpers";

setUpHarness();

const { t } = createI18n();

const BOT_LOGIN = "renovate[bot]";

/** One file past the hunk limit a single call takes. */
const MANY_FILES = 121;
/** One changed line past 400k tokens at 67 bytes per line. */
const MANY_LINES = 11_941;

/** graphile holds the running job's row locked; the stub does not. */
async function lockQueuedJobs(): Promise<void> {
  await harness.raw("update graphile_worker.jobs set locked_at = now()");
}

async function readJobs(): Promise<Record<string, unknown>[]> {
  return harness.raw(
    "select task_identifier, key, locked_at, payload->>'head_sha' as head from graphile_worker.jobs order by id",
  );
}

async function listTasks(): Promise<unknown[]> {
  const jobs = await readJobs();
  return jobs.map((job) => job["task_identifier"]);
}

function makeLargeBotGitHub(): FakeGitHub {
  const github = makeGitHub(HEAD_1);
  github.updatePullRequest(PR_REF, {
    changedFiles: MANY_FILES,
    authorLogin: BOT_LOGIN,
    authorIsBot: true,
  });
  return github;
}

async function countAttempts(): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as total from generation_attempt",
  );
  return Number(rows[0]?.["total"]);
}

describe("large pool routing", () => {
  it("moves a job with many changed files to the large pool unclaimed", async () => {
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: MANY_FILES });
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();
    const { pr, payload } = await trigger(HEAD_1);
    await lockQueuedJobs();

    await makeTask({ github, generator, log: logger })(payload);

    const jobs = await readJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.["key"]).toBeNull();
    expect(jobs[1]).toMatchObject({
      task_identifier: "generate-large",
      key: `generate:${pr.id}`,
      locked_at: null,
      head: HEAD_1,
    });
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.PENDING);
    expect(await countAttempts()).toBe(0);
    expect(generator.calls).toEqual([]);
    const moved = readLines().find((line) =>
      String(line["msg"]).includes("moves to the large pool"),
    );
    expect(moved).toMatchObject({ changedFiles: MANY_FILES, changedLines: 10 });
  });

  it("moves a job with many changed lines to the large pool", async () => {
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { additions: MANY_LINES, deletions: 0 });
    const { payload } = await trigger(HEAD_1);
    await lockQueuedJobs();

    await makeTask({ github })(payload);

    const tasks = await listTasks();
    expect(tasks).toEqual(["generate", "generate-large"]);
  });

  it("stands down when a newer job already waits under the key", async () => {
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: MANY_FILES });
    const generator = stubGenerator();
    const { pr, payload } = await trigger(HEAD_1);

    await makeTask({ github, generator })(payload);

    const tasks = await listTasks();
    expect(tasks).toEqual(["generate"]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.PENDING);
    expect(await countAttempts()).toBe(0);
    expect(generator.calls).toEqual([]);
  });

  it("runs a small pull request in the normal pool as before", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await lockQueuedJobs();

    await makeTask()(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    const tasks = await listTasks();
    expect(tasks).not.toContain("generate-large");
  });

  it("never moves the large pool's own job, whatever the counts", async () => {
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: MANY_FILES });
    const { pr, payload } = await trigger(HEAD_1);
    await lockQueuedJobs();

    await makeLargePoolTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect(await countAttempts()).toBe(1);
    const tasks = await listTasks();
    expect(tasks).not.toContain("generate-large");
  });

  it("leaves a run over the pair's stored brief in the normal pool", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await makeTask()(payload);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: MANY_FILES });
    const rerun = await trigger(HEAD_1);
    await lockQueuedJobs();

    await makeTask({ github })(rerun.payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    const tasks = await listTasks();
    expect(tasks).not.toContain("generate-large");
  });

  it("moves a recovery run under the head's recovery key", async () => {
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: MANY_FILES });
    const { pr, payload } = await trigger(HEAD_1);
    const projection = createGenerationProjection(harness.handle, ctx);
    const holder = await claimTestRun(projection, makeTarget(pr, HEAD_1));
    await lockQueuedJobs();
    await harness.raw(
      "update generation set lease_expires_at = now() - interval '1 second'",
    );

    await makeRecoveryTask({ github })(payload);

    const jobs = await readJobs();
    expect(jobs.at(-1)).toMatchObject({
      task_identifier: "recover-generation-large",
      key: `recover-generation:${pr.id}:${HEAD_1}`,
      head: HEAD_1,
    });
    const row = await projection.get(makeTarget(pr, HEAD_1));
    expect(row?.runId).toBe(holder);
    expect(await countAttempts()).toBe(1);
  });

  it("posts a large gated head's on-demand Entry from the normal pool", async () => {
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: MANY_FILES });
    const { pr, payload } = await trigger(HEAD_1, {
      requiresTriggerApproval: true,
    });
    await lockQueuedJobs();

    await makeTask({ github })(payload);

    expect(await listTasks()).toEqual(["generate"]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    const onDemand = buildEntryCommentOnDemandBody(t, {
      ...ENTRY_PR_VIEW,
      headIndex: FIRST_BRIEF_INDEX,
    });
    expect(readLiveBodies(github)).toEqual([onDemand]);
  });

  it("holds a large untrusted bot PR in the normal pool", async () => {
    const github = makeLargeBotGitHub();
    const { pr, payload } = await trigger(HEAD_1);
    await lockQueuedJobs();

    await makeTask({ github })(payload);

    expect(await listTasks()).toEqual(["generate"]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(await countAttempts()).toBe(0);
  });

  it("moves a large trusted bot PR to the large pool after its gate", async () => {
    const github = makeLargeBotGitHub();
    const settings = `version: 1\ntrustedBots:\n  - ${BOT_LOGIN}\n`;
    github.addRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      buildRepoFile(settings, "sha-settings"),
    );
    const { pr, payload } = await trigger(HEAD_1);
    await lockQueuedJobs();

    await makeTask({ github })(payload);

    expect(await listTasks()).toEqual(["generate", "generate-large"]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.PENDING);
    expect(await countAttempts()).toBe(0);
  });
});
