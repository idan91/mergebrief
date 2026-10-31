import { MAX_BRIEFED_CHANGED_FILES } from "brief-core/types";
import { createGenerationProjection } from "persistence";
import { FakeFailures } from "github/testing";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { describe, expect, it } from "vitest";
import { TransientJobError } from "../../src/task/failure";
import {
  arrangeCompare,
  BASE,
  ctx,
  harness,
  HEAD_1,
  makeGitHub,
  makeInOrderGrouping,
  makeLargePoolTask,
  makeTarget,
  makeTask,
  PR_REF,
  setUpHarness,
  stubGenerator,
  stubThreeGroupGenerator,
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

/** The diff bytes one model call takes: 400,000 input tokens at 2 bytes a token. */
const ONE_CALL_DIFF_BYTES = 800_000;
/** Fewer files than one call's hunk limit, so only the bytes route the run. */
const BYTE_HEAVY_FILES = 100;
const ADDED_LINE_BYTES = 8_500;

const PAST_ONE_CALL_PATHS = Array.from(
  { length: BYTE_HEAVY_FILES },
  (_, index) => `src/f${index + 1}.ts`,
);

const PAST_ONE_CALL_DIFF = PAST_ONE_CALL_PATHS.map((path) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-old",
    `+${"x".repeat(ADDED_LINE_BYTES)}`,
    "",
  ].join("\n"),
).join("");

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

  it("fails as diff-too-large past the file cap in the large pool", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { changedFiles: PAST_BRIEFED_FILE_CAP });
    github.failOn("fetchDiff", FakeFailures.NOT_ACCEPTABLE);

    await makeLargePoolTask({ github })(payload);

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

  it("routes a compare diff past one call's bytes to the multi-call run", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const files = PAST_ONE_CALL_PATHS.map((path) => ({
      path,
      additions: 1,
      deletions: 1,
    }));
    const github = makeGitHub(HEAD_1, files);
    github.updatePullRequest(PR_REF, { changedFiles: files.length });
    arrangeCompare(github, { base: BASE, head: HEAD_1 }, PAST_ONE_CALL_DIFF);
    github.failOn("fetchDiff", FakeFailures.NOT_ACCEPTABLE);
    const generator = stubThreeGroupGenerator(
      makeInOrderGrouping(files.length),
    );

    await makeTask({ github, generator })(payload);

    expect(Buffer.byteLength(PAST_ONE_CALL_DIFF, "utf8")).toBeGreaterThan(
      ONE_CALL_DIFF_BYTES,
    );
    expect((await readRow(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(generator.calls[0]).toBe("grouping");
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
