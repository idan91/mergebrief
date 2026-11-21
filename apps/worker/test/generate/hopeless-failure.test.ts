import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createIngestRoutines,
  type PullRequestRow,
} from "persistence";
import { parseInstanceTriggerConditions } from "generators/trigger-conditions";
import type { FakeGitHub } from "github/testing";
import { RepoConfigPaths } from "repo-config";
import { GenerationFailureCodes, GenerationStatuses } from "types";
import {
  countStartedRuns,
  ctx,
  harness,
  HEAD_1,
  interceptInstallationRepo,
  makeGitHub,
  makeTarget,
  makeTask,
  PR_REF,
  setUpHarness,
  stubGenerator,
  stubMultiCallGenerator,
  trigger,
} from "./helpers";

setUpHarness();

function makeReadyForReview() {
  const parsed = parseInstanceTriggerConditions({ readyForReview: "on" });
  if (!parsed.ok) {
    throw new Error(parsed.error.issues.join("; "));
  }
  return parsed.value;
}

/**
 * A fact event lands while the run reads its settings, before its claim: the
 * run's job is locked, so the recheck queues a follow-up job beside it.
 */
function recheckBeforeClaim(github: FakeGitHub, pr: PullRequestRow): void {
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async fetchRepoFile(input) {
      if (input.path === RepoConfigPaths.SETTINGS) {
        await harness.raw("update graphile_worker.jobs set locked_at = now()");
        await createIngestRoutines(harness.handle, ctx).recheckCurrentHead({
          pullRequestId: pr.id,
        });
      }
      return client.fetchRepoFile(input);
    },
  }));
}

async function readFollowUpPayload(pr: PullRequestRow): Promise<unknown> {
  const jobs = await harness.raw(
    `select payload from graphile_worker.jobs where key = 'generate:${pr.id}'`,
  );
  if (jobs.length !== 1) {
    throw new Error(`expected one follow-up job, found ${jobs.length}`);
  }
  return jobs[0]?.["payload"];
}

/** The first run fails output-cut for good, a follow-up job queued meanwhile. */
async function failCutWithFollowUp() {
  const { pr, payload } = await trigger(HEAD_1);
  const github = makeGitHub(HEAD_1);
  recheckBeforeClaim(github, pr);
  const cut = stubMultiCallGenerator(["brief", "grouping"]);

  await makeTask({ github, generator: cut })(payload);

  const followUp = await readFollowUpPayload(pr);
  const startedRuns = await countStartedRuns();
  return { pr, followUp, startedRuns };
}

async function readRow(pr: PullRequestRow) {
  return createGenerationProjection(harness.handle, ctx).get(
    makeTarget(pr, HEAD_1),
  );
}

describe("a follow-up job after a failure a rerun cannot help", () => {
  it("stands down without a claim or a model call", async () => {
    const { pr, followUp, startedRuns } = await failCutWithFollowUp();
    const generator = stubGenerator();

    await makeTask({ github: makeGitHub(HEAD_1), generator })(followUp);

    expect(generator.calls).toEqual([]);
    expect(await countStartedRuns()).toBe(startedRuns);
    const row = await readRow(pr);
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.OUTPUT_CUT);
  });

  it("keeps the failure when the pull request went back to draft", async () => {
    const { pr, followUp, startedRuns } = await failCutWithFollowUp();
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const generator = stubGenerator();

    await makeTask({
      github,
      generator,
      triggerConditions: makeReadyForReview(),
    })(followUp);

    expect(generator.calls).toEqual([]);
    expect(await countStartedRuns()).toBe(startedRuns);
    const row = await readRow(pr);
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.OUTPUT_CUT);
    expect(row?.unmetConditions).toBeNull();
  });
});
