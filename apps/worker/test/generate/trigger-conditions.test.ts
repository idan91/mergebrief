import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createIngestRoutines,
  parseUnmetConditions,
  type PullRequestRow,
} from "persistence";
import { parseInstanceTriggerConditions } from "generators/trigger-conditions";
import { FakeFailures, type FakeGitHub } from "github/testing";
import { RepoConfigPaths } from "repo-config";
import { GenerationStatuses } from "types";
import {
  buildRepoFile,
  countStartedRuns,
  ctx,
  FIRST_ATTEMPT,
  harness,
  HEAD_1,
  failFirstSettingsRead,
  interceptInstallationRepo,
  makeGitHub,
  makeReviewerId,
  makeTarget,
  makeTask,
  type ReadCount,
  PR_REF,
  readRowStatus,
  REPO,
  setUpHarness,
  stubGenerator,
  trigger,
} from "./helpers";
import { SETTINGS_READ_RETRY_DELAYS_MS } from "../../src/task/generate/logic/run-gates";

setUpHarness();

function makeInstanceConditions(block: unknown) {
  const parsed = parseInstanceTriggerConditions(block);
  if (!parsed.ok) {
    throw new Error(parsed.error.issues.join("; "));
  }
  return parsed.value;
}

function addSettings(github: ReturnType<typeof makeGitHub>, content: string) {
  github.addRepoFile(
    REPO,
    { path: RepoConfigPaths.SETTINGS },
    buildRepoFile(content, "sha-settings"),
  );
}

async function readUnmet(pr: PullRequestRow) {
  const row = await createGenerationProjection(harness.handle, ctx).get(
    makeTarget(pr, HEAD_1),
  );
  return parseUnmetConditions(row?.unmetConditions ?? null)?.conditions;
}

const SETTINGS_READS_PER_RUN = SETTINGS_READ_RETRY_DELAYS_MS.length + 1;

/** Counts the run's `settings.yaml` reads, calling `onRead` before each. */
function countSettingsReads(
  github: FakeGitHub,
  onRead: () => Promise<void> = async () => {},
): ReadCount {
  const reads: ReadCount = { count: 0 };
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async fetchRepoFile(input) {
      if (input.path === RepoConfigPaths.SETTINGS) {
        reads.count += 1;
        await onRead();
      }
      return client.fetchRepoFile(input);
    },
  }));
  return reads;
}

describe("generate task, trigger conditions", () => {
  it("holds a draft under the instance's readyForReview with no claim", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const generator = stubGenerator();

    await makeTask({
      github,
      generator,
      triggerConditions: makeInstanceConditions({ readyForReview: "on" }),
    })(payload);

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      { kind: "ready-for-review", setBy: "instance" },
    ]);
    expect(await countStartedRuns()).toBe(0);
  });

  it("reads the repo's conditions when a settings read clears in the run", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, "version: 1\ntriggerConditions:\n  never: on\n");
    const failing = makeGitHub(HEAD_1);
    failing.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );
    const reads = failFirstSettingsRead(github, failing);

    await makeTask({ github })(payload, { job: FIRST_ATTEMPT });

    expect(reads.count).toBe(2);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([{ kind: "never", setBy: "repo" }]);
  });

  it("holds on the instance's conditions when every read in the run fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    github.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );
    const statuses: (string | undefined)[] = [];
    const reads = countSettingsReads(github, async () => {
      statuses.push(await readRowStatus(pr, HEAD_1));
    });

    await makeTask({
      github,
      triggerConditions: makeInstanceConditions({ readyForReview: "on" }),
    })(payload, { job: FIRST_ATTEMPT });

    expect(reads.count).toBe(SETTINGS_READS_PER_RUN);
    expect(statuses).not.toContain(GenerationStatuses.FAILED);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      { kind: "ready-for-review", setBy: "instance" },
    ]);
  });

  it("generates a held draft on its next run once it is ready", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const readyForReview = makeInstanceConditions({ readyForReview: "on" });
    await makeTask({ github, triggerConditions: readyForReview })(payload);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);

    github.updatePullRequest(PR_REF, { draft: false });
    await makeTask({ github, triggerConditions: readyForReview })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
    expect(await readUnmet(pr)).toBeUndefined();
  });

  it("generates a ready pull request under readyForReview", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();

    await makeTask({
      generator,
      triggerConditions: makeInstanceConditions({ readyForReview: "on" }),
    })(payload);

    expect(generator.calls.length).toBeGreaterThan(0);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("holds on the repo's own never, naming the repository", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, "version: 1\ntriggerConditions:\n  never: on\n");

    await makeTask({ github })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([{ kind: "never", setBy: "repo" }]);
  });

  it("generates when the repo switches the instance's conditions off", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, "version: 1\ntriggerConditions: off\n");

    await makeTask({
      github,
      triggerConditions: makeInstanceConditions({ never: "on" }),
    })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("generates a head a Generate click released, skipping the conditions", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const never = makeInstanceConditions({ never: "on" });
    await makeTask({ triggerConditions: never })(payload);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);

    await createIngestRoutines(harness.handle, ctx).triggerOnDemand({
      pullRequestId: pr.id,
      approverId: makeReviewerId(900n),
    });
    const released = await harness.raw(
      "select payload from graphile_worker.jobs where task_identifier = 'generate' order by id desc limit 1",
    );
    const releasedPayload = released[0]?.["payload"];
    await makeTask({ triggerConditions: never })(releasedPayload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });
});
