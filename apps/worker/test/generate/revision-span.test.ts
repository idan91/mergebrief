import { claimTestRun } from "persistence/testing";
import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
  type PullRequestRow,
} from "persistence";
import { FakeFailures, type FakeGitHub } from "github/testing";
import { GenerationStatuses } from "types/generations";
import { describe, expect, it } from "vitest";
import {
  arrangeCompare,
  arrangeNewHeadPrDiff,
  BASE,
  buildRepoFile,
  captureLogger,
  ctx,
  FIRST_ATTEMPT,
  harness,
  HEAD_1,
  HEAD_2,
  LAST_ATTEMPT,
  makeGitHub,
  makeRecoveryTask,
  makeReviewerId,
  makeTarget,
  makeTask,
  PR_REF,
  REPO,
  setUpHarness,
  stubGenerator,
  trigger,
  type StubGenerator,
  type TaskOverrides,
} from "./helpers";

setUpHarness();

/** A base the PR is retargeted onto between its two heads. */
const OTHER_BASE = "e".repeat(40);
/** A reviewer's checkpoint SHA no Brief was ever written for. */
const UNBRIEFED_HEAD = "d".repeat(40);

/** The PR's own change to a.ts, byte-identical at every head. */
const A_PR_DIFF = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 line
+added
 line2
`;

/** c.ts, a file the PR adds at the second head only. */
const C_PR_DIFF = `diff --git a/c.ts b/c.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/c.ts
@@ -0,0 +1,2 @@
+one
+two
`;

/** logo.png, a binary the PR adds, with another blob at each head. */
function makeBinaryPrDiff(blobId: string): string {
  return `diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..${blobId}
Binary files /dev/null and b/logo.png differ
`;
}

/** What a catch-up merge of main brings in between the heads, outside the PR's own change. */
const MAIN_MERGE_DIFF = `diff --git a/main.ts b/main.ts
index 5555555..6666666 100644
--- a/main.ts
+++ b/main.ts
@@ -1 +1,2 @@
 main
+merged from main
`;

interface SecondHead {
  readonly pr: PullRequestRow;
  readonly payload: unknown;
}

/** Each head's PR diff, as the compare endpoint serves it against its base. */
function arrangePrDiffs(
  github: FakeGitHub,
  prevPrDiff: string,
  newPrDiff: string,
  newBase = BASE,
): void {
  arrangeCompare(github, { base: BASE, head: HEAD_1 }, prevPrDiff);
  arrangeNewHeadPrDiff(github, newPrDiff, newBase);
  github.addRepoFile(
    REPO,
    { path: "c.ts", ref: HEAD_2 },
    buildRepoFile("one\ntwo\n", "3333333"),
  );
}

async function checkpointReviewerAt(
  pr: PullRequestRow,
  sha: string,
): Promise<void> {
  await createTenantRepository(harness.handle, ctx).checkpoints.upsertOnSubmit({
    pullRequestId: pr.id,
    reviewerId: makeReviewerId(100n),
    lastSubmittedSha: sha,
    submittedAt: new Date(),
  });
}

/** Briefs HEAD_1 with a reviewer's checkpoint there, then triggers HEAD_2. */
async function pushSecondHead(
  github: FakeGitHub,
  overrides: TaskOverrides = {},
): Promise<SecondHead> {
  const first = await trigger(HEAD_1);
  await makeTask({ ...overrides, github })(first.payload);
  await checkpointReviewerAt(first.pr, HEAD_1);
  github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
  return trigger(HEAD_2);
}

async function readSpanBodies(pr: PullRequestRow, baselineSha = HEAD_1) {
  const store = createArtifactStore(harness.handle, ctx);
  const [marks, narrative, delta] = await Promise.all([
    store.comparisonMarks.get(pr.id, baselineSha, HEAD_2),
    store.revisionNarratives.get(pr.id, baselineSha, HEAD_2),
    store.deltas.get(pr.id, baselineSha, HEAD_2),
  ]);
  return {
    marks: marks === undefined ? undefined : JSON.parse(marks.body),
    narrative: narrative === undefined ? undefined : JSON.parse(narrative.body),
    delta: delta === undefined ? undefined : JSON.parse(delta.body),
  };
}

function listSpanCalls(generator: StubGenerator): string[] {
  return generator.calls.filter((label) => label !== "brief");
}

function listCompareSpans(github: FakeGitHub): string[] {
  const calls = github.listCalls("fetchCheckedCompareDiff");
  return calls.map((call) => {
    const input = call.input as { base: string; head: string };
    return `${input.base.slice(0, 1)}...${input.head.slice(0, 1)}`;
  });
}

describe("generate task, the revision span on the PR's own diffs", () => {
  it("marks and narrates only the files the PR's own change moved", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    const generator = stubGenerator();

    await makeTask({ github, generator })(second.payload);

    const { marks } = await readSpanBodies(second.pr);
    const paths = marks.files.map((entry: { file: string }) => entry.file);
    expect(paths).toEqual(["c.ts"]);
    expect(generator.calls).toContain("revision narrative");
    expect(generator.calls).toContain("delta");
  });

  it("writes three no-change records and spends nothing on an unchanged push", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, A_PR_DIFF);
    const spend = { maxGenerationsPerDay: 2 };
    const second = await pushSecondHead(github, { spend });
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();

    await makeTask({ github, generator, spend, log: logger })(second.payload);

    const bodies = await readSpanBodies(second.pr);
    expect(bodies.marks).toMatchObject({ files: [] });
    expect(bodies.narrative).toMatchObject({
      artifactKind: "revisionNarrativeUnchanged",
      prevHeadSha: HEAD_1,
      headSha: HEAD_2,
    });
    expect(bodies.delta).toMatchObject({
      artifactKind: "deltaUnchanged",
      baselineSha: HEAD_1,
      headSha: HEAD_2,
    });
    expect(listSpanCalls(generator)).toEqual([]);
    const trips = readLines().filter(
      (line) => line["evt"] === "spend.cap.trip",
    );
    expect(trips).toEqual([]);
  });

  it("reads a catch-up merge of main on one base as unchanged", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, A_PR_DIFF);
    arrangeCompare(github, { base: HEAD_1, head: HEAD_2 }, MAIN_MERGE_DIFF);
    const second = await pushSecondHead(github);
    const generator = stubGenerator();

    await makeTask({ github, generator })(second.payload);

    const bodies = await readSpanBodies(second.pr);
    expect(bodies.marks).toMatchObject({ files: [] });
    expect(bodies.narrative).toMatchObject({
      artifactKind: "revisionNarrativeUnchanged",
    });
    expect(bodies.delta).toMatchObject({ artifactKind: "deltaUnchanged" });
    expect(listSpanCalls(generator)).toEqual([]);
  });

  it("narrates a binary changed between heads over zero-file marks", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(
      github,
      `${A_PR_DIFF}${makeBinaryPrDiff("4444444")}`,
      `${A_PR_DIFF}${makeBinaryPrDiff("7777777")}`,
    );
    const second = await pushSecondHead(github);
    const generator = stubGenerator();

    await makeTask({ github, generator })(second.payload);

    const bodies = await readSpanBodies(second.pr);
    expect(bodies.marks).toMatchObject({ files: [] });
    expect(bodies.narrative?.artifactKind).not.toBe(
      "revisionNarrativeUnchanged",
    );
    expect(generator.calls).toContain("revision narrative");
    expect(generator.calls).toContain("delta");
  });

  it("refuses a new-head PR diff short of GitHub's file count", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, A_PR_DIFF);
    github.updatePullRequest(PR_REF, { changedFiles: 2 });
    const second = await pushSecondHead(github);

    await makeTask({ github })(second.payload);

    const bodies = await readSpanBodies(second.pr);
    expect(bodies.marks).toBeUndefined();
    expect(bodies.narrative).toMatchObject({ skipped: "span too large" });
    expect(bodies.delta).toMatchObject({ skipped: "span-too-large" });
  });

  it("keeps the config's narrative skip over an unchanged push", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, A_PR_DIFF);
    const revisionNarrative = { enabled: false };
    const second = await pushSecondHead(github, { revisionNarrative });

    await makeTask({ github, revisionNarrative })(second.payload);

    const bodies = await readSpanBodies(second.pr);
    expect(bodies.narrative).toMatchObject({
      artifactKind: "revisionNarrativeSkipped",
      skipped: "disabled by config",
    });
    expect(bodies.delta).toMatchObject({ artifactKind: "deltaUnchanged" });
    expect(bodies.marks).toMatchObject({ files: [] });
  });

  it("reads each head against its own Brief's base after a retarget", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`, OTHER_BASE);
    const second = await pushSecondHead(github);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2, baseSha: OTHER_BASE });
    const retargeted = await trigger(HEAD_2);

    await makeTask({ github })(retargeted.payload);

    expect(listCompareSpans(github)).toEqual(
      expect.arrayContaining(["c...a", "e...b"]),
    );
    expect(second.pr.id).toBe(retargeted.pr.id);
  });

  it("reads a checkpoint with no Brief against the PR's current base", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`, OTHER_BASE);
    arrangeCompare(
      github,
      { base: OTHER_BASE, head: UNBRIEFED_HEAD },
      A_PR_DIFF,
    );
    const second = await pushSecondHead(github);
    await checkpointReviewerAt(second.pr, UNBRIEFED_HEAD);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2, baseSha: OTHER_BASE });

    await makeTask({ github })(second.payload);

    expect(listCompareSpans(github)).toContain("e...d");
    const { delta } = await readSpanBodies(second.pr, UNBRIEFED_HEAD);
    expect(delta).toBeDefined();
  });
});

describe("generate task, a revision span GitHub fails to serve", () => {
  it("throws for a retry on a transient failure before the last attempt", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    github.failOn("fetchCheckedCompareDiff", FakeFailures.SERVER_ERROR);
    const generator = stubGenerator();

    await expect(
      makeTask({ github, generator })(second.payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("generate: revision span read failed");

    expect(generator.calls).toEqual([]);
  });

  it("writes nothing for the span when the last attempt cannot read it", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    github.failOn("fetchCheckedCompareDiff", FakeFailures.SERVER_ERROR);
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();

    await makeTask({ github, generator, log: logger })(second.payload, {
      job: LAST_ATTEMPT,
    });

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(second.pr, HEAD_2),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(await readSpanBodies(second.pr)).toEqual({
      marks: undefined,
      narrative: undefined,
      delta: undefined,
    });
    expect(listSpanCalls(generator)).toEqual([]);
    const spanWarnings = readLines().filter((line) =>
      String(line["msg"]).includes("revision span"),
    );
    expect(spanWarnings).toHaveLength(1);
  });

  it("hands a takeover's transient failure back at the attempt limit", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    const projection = createGenerationProjection(harness.handle, ctx);
    await claimTestRun(projection, makeTarget(second.pr, HEAD_2));
    await harness.raw("update graphile_worker.jobs set locked_at = now()");
    await harness.raw(
      "update generation set lease_expires_at = now() - interval '1 second'",
    );
    github.failOn("fetchCheckedCompareDiff", FakeFailures.SERVER_ERROR);

    await expect(
      makeRecoveryTask({ github })(second.payload, { job: LAST_ATTEMPT }),
    ).rejects.toThrow("generate: revision span read failed");

    expect((await readSpanBodies(second.pr)).marks).toBeUndefined();
  });
});
