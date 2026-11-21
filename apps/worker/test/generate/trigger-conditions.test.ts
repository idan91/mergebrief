import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createIngestRoutines,
  parseUnmetConditions,
  type PullRequestRow,
} from "persistence";
import { parseInstanceTriggerConditions } from "generators/trigger-conditions";
import { RepoConfigPaths } from "repo-config";
import { GenerationStatuses } from "types";
import {
  buildRepoFile,
  countStartedRuns,
  ctx,
  harness,
  HEAD_1,
  makeGitHub,
  makeReviewerId,
  makeTarget,
  makeTask,
  PR_REF,
  readRowStatus,
  REPO,
  setUpHarness,
  stubGenerator,
  trigger,
} from "./helpers";

setUpHarness();

function instanceConditions(block: unknown) {
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
  return parseUnmetConditions(row?.unmetConditions ?? null);
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
      triggerConditions: instanceConditions({ readyForReview: "on" }),
    })(payload);

    expect(generator.calls).toEqual([]);
    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.HELD);
    expect(await readUnmet(pr)).toEqual([
      { kind: "ready-for-review", source: "instance" },
    ]);
    expect(await countStartedRuns()).toBe(0);
  });

  it("generates a ready pull request under readyForReview", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();

    await makeTask({
      generator,
      triggerConditions: instanceConditions({ readyForReview: "on" }),
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
    expect(await readUnmet(pr)).toEqual([{ kind: "never", source: "repo" }]);
  });

  it("generates when the repo switches the instance's conditions off", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    addSettings(github, "version: 1\ntriggerConditions: off\n");

    await makeTask({
      github,
      triggerConditions: instanceConditions({ never: "on" }),
    })(payload);

    expect(await readRowStatus(pr, HEAD_1)).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("generates a head a Generate click released, skipping the conditions", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const never = instanceConditions({ never: "on" });
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
