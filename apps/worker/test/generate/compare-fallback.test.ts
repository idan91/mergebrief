import { MAX_BRIEFED_CHANGED_FILES } from "brief-core/types";
import { createGenerationProjection } from "persistence";
import { FakeFailures } from "github/testing";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { describe, expect, it } from "vitest";
import { TransientJobError } from "../../src/task/failure";
import { SINGLE_CALL_MAX_DIFF_BYTES } from "../../src/task/generate/consts";
import {
  arrangeCompare,
  BASE,
  ctx,
  harness,
  HEAD_1,
  makeGitHub,
  makeTarget,
  makeTask,
  PR_REF,
  setUpHarness,
  stubGenerator,
  trigger,
} from "./helpers";

setUpHarness();

const TWO_FILE_DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
 line
+added
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1,2 @@
 other
+added
`;

const PAST_BRIEFED_FILE_CAP = MAX_BRIEFED_CHANGED_FILES + 1;

const PAST_ONE_CALL_DIFF = `${TWO_FILE_DIFF}+${"x".repeat(SINGLE_CALL_MAX_DIFF_BYTES)}
`;

async function readRow(pr: Awaited<ReturnType<typeof trigger>>["pr"]) {
  return createGenerationProjection(harness.handle, ctx).get(
    makeTarget(pr, HEAD_1),
  );
}

describe("generate task, compare fallback on a 406", () => {
  it("briefs from the checked compare diff when the PR diff answers 406", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: 2 });
    arrangeCompare(github, { base: BASE, head: HEAD_1 }, TWO_FILE_DIFF);
    github.failOn("fetchDiff", FakeFailures.NOT_ACCEPTABLE);
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload);

    expect((await readRow(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(github.listCalls("fetchCheckedCompareDiff")).toMatchObject([
      { input: { base: BASE, head: HEAD_1, expectedFileCount: 2 } },
    ]);
    expect(generator.requests[0]?.user).toContain("b.ts");
  });

  it("fails as diff-too-large past the file cap without a compare read", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: PAST_BRIEFED_FILE_CAP });
    github.failOn("fetchDiff", FakeFailures.NOT_ACCEPTABLE);

    await makeTask({ github })(payload);

    const row = await readRow(pr);
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.DIFF_TOO_LARGE);
    expect(github.listCalls("fetchCheckedCompareDiff")).toEqual([]);
  });

  it("fails as diff-too-large when the compare diff comes back short", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: 2 });
    github.failOn("fetchDiff", FakeFailures.NOT_ACCEPTABLE);

    await makeTask({ github })(payload);

    const row = await readRow(pr);
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.DIFF_TOO_LARGE);
  });

  it("fails as diff-too-large when the compare diff exceeds one call", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: 2 });
    arrangeCompare(github, { base: BASE, head: HEAD_1 }, PAST_ONE_CALL_DIFF);
    github.failOn("fetchDiff", FakeFailures.NOT_ACCEPTABLE);
    const generator = stubGenerator();

    await makeTask({ github, generator })(payload);

    const row = await readRow(pr);
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.DIFF_TOO_LARGE);
    expect(generator.requests).toEqual([]);
  });

  it("leaves a compare that timed out to graphile's retry", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.failOn("fetchDiff", FakeFailures.NOT_ACCEPTABLE);
    github.failOn("fetchCheckedCompareDiff", FakeFailures.DIFF_TIMED_OUT);

    await expect(makeTask({ github })(payload)).rejects.toThrow(
      TransientJobError,
    );

    const row = await readRow(pr);
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.GITHUB_UNAVAILABLE);
  });
});
