import { AnchorWarnings } from "brief-core/types";
import { claimTestRun } from "persistence/testing";
import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
  type BriefSpanRow,
  type PullRequestRow,
} from "persistence";
import { FakeFailures, type FakeGitHub } from "github/testing";
import { GenerationStatuses } from "types/generations";
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import type { Effort, GenerateRequest, Generator } from "generators";
import { resolveSpanBaseline } from "../../src/task/generate/logic/revision-span";
import {
  arrangeCompare,
  arrangeForcePush,
  arrangeNewHeadPrDiff,
  interceptInstallationRepo,
  BASE,
  buildRepoFile,
  captureLogger,
  ctx,
  FIRST_ATTEMPT,
  harness,
  HEAD_1,
  makeConnectionError,
  HEAD_2,
  LAST_ATTEMPT,
  makeGitHub,
  makeRecoveryTask,
  makeReviewerId,
  makeTarget,
  makeTask,
  PR_REF,
  readRowStatus,
  REPO,
  setUpHarness,
  stubGenerator,
  trigger,
  type TriggerOptions,
  type StubGenerator,
  type TaskOverrides,
} from "./helpers";

setUpHarness();

/** A base the PR is retargeted onto between its two heads. */
const OTHER_BASE = "e".repeat(40);
/** A head pushed while a run is still writing its span artifacts. */
const NEWER_HEAD = "f".repeat(40);
/** Main before the catch-up merge: the first head's merge base with BASE. */
const OLDER_MAIN = "9".repeat(40);
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

/** The stub's answers, with `afterCall` run once a `label` call returns. */
function stubHookedGenerator(
  inner: StubGenerator,
  label: string,
  afterCall: () => void,
): Generator {
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      const output = await inner.generate(req);
      if (req.label === label) {
        afterCall();
      }
      return output;
    },
    origin: (effort: Effort) => inner.origin(effort),
  };
}

/** The stub's answers, with every delta call failing on a dropped connection. */
function stubFailingDeltaGenerator(inner: StubGenerator): Generator {
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      if (req.label === "delta") {
        throw makeConnectionError();
      }
      return inner.generate(req);
    },
    origin: (effort: Effort) => inner.origin(effort),
  };
}

/** Once `isArmed` holds, the next Entry comment write lands and NEWER_HEAD is pushed. */
function pushHeadAfterEntryWrite(
  github: FakeGitHub,
  isArmed: () => boolean,
): void {
  function pushIfArmed(): void {
    if (isArmed()) {
      github.updatePullRequest(PR_REF, { headSha: NEWER_HEAD });
    }
  }
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async postEntryComment(comment) {
      const posted = await client.postEntryComment(comment);
      pushIfArmed();
      return posted;
    },
    async editComment(commentId, body) {
      const edited = await client.editComment(commentId, body);
      pushIfArmed();
      return edited;
    },
  }));
}

async function countStartedRuns(): Promise<number> {
  const window = 60_000;
  return createGenerationProjection(harness.handle, ctx).countStartedRuns({
    from: new Date(Date.now() - window),
    to: new Date(Date.now() + window),
  });
}

describe("generate task, the revision span on the PR's own diffs", () => {
  it("marks and narrates only the files the PR's own change moved", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    arrangeForcePush(github);
    const second = await pushSecondHead(github);
    const generator = stubGenerator();

    await makeTask({ github, generator })(second.payload);

    const { marks } = await readSpanBodies(second.pr);
    const paths = marks.files.map((entry: { file: string }) => entry.file);
    expect(paths).toEqual(["c.ts"]);
    expect(generator.calls).toContain("revision narrative");
    expect(generator.calls).toContain("delta");
  });

  it("marks a plain push from the compare between the heads", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    arrangeCompare(github, { base: HEAD_1, head: HEAD_2 }, C_PR_DIFF);
    const second = await pushSecondHead(github);
    const generator = stubGenerator();

    await makeTask({ github, generator })(second.payload);

    const { marks } = await readSpanBodies(second.pr);
    const paths = marks.files.map((entry: { file: string }) => entry.file);
    expect(paths).toEqual(["c.ts"]);
    expect(listCompareSpans(github)).not.toContain("c...a");
    const prevHeadBlobs = github
      .listCalls("fetchRepoFile")
      .filter((call) => (call.input as { ref?: string }).ref === HEAD_1);
    expect(prevHeadBlobs).toEqual([]);
    expect(generator.calls).toContain("delta");
  });

  it("writes three no-change records and spends nothing on an unchanged push", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, A_PR_DIFF);
    arrangeForcePush(github);
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
    github.addCompare(
      REPO,
      { base: BASE, head: HEAD_1 },
      { diff: A_PR_DIFF, mergeBase: OLDER_MAIN },
    );
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
    arrangeForcePush(github);
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
    arrangeForcePush(github);
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
    arrangeForcePush(github, UNBRIEFED_HEAD);
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

  it("stores the unavailable span on the last attempt's brief", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    github.failOn("fetchCheckedCompareDiff", FakeFailures.SERVER_ERROR);

    await makeTask({ github, generator: stubGenerator() })(second.payload, {
      job: LAST_ATTEMPT,
    });

    const row = await createArtifactStore(harness.handle, ctx).briefs.get(
      second.pr.id,
      BASE,
      HEAD_2,
    );
    expect(JSON.parse(row?.body ?? "{}")).toMatchObject({
      anchorWarnings: [AnchorWarnings.SPAN_UNAVAILABLE],
    });
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

async function readMarksRefs(pr: PullRequestRow) {
  const row = await createArtifactStore(
    harness.handle,
    ctx,
  ).comparisonMarks.get(pr.id, HEAD_1, HEAD_2);
  return row === undefined
    ? undefined
    : { prevBase: row.prevBaseSha, newBase: row.newBaseSha };
}

/** HEAD_2 briefed over BASE with a checkpoint at HEAD_1, then the PR retargeted onto `base` at the same head. */
async function retargetSecondHead(
  github: FakeGitHub,
  base: string,
  options: TriggerOptions = {},
): Promise<SecondHead> {
  arrangeNewHeadPrDiff(github, `${A_PR_DIFF}${C_PR_DIFF}`, base);
  github.updatePullRequest(PR_REF, { headSha: HEAD_2, baseSha: base });
  return trigger(HEAD_2, options);
}

describe("generate task, the refs a span's marks row certifies", () => {
  it("rewrites the delta, narrative and marks after a same-head retarget", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    await makeTask({ github })(second.payload);
    const retargeted = await retargetSecondHead(github, OTHER_BASE);
    const generator = stubGenerator();
    const runsBefore = await countStartedRuns();

    await makeTask({ github, generator })(retargeted.payload);

    expect(listSpanCalls(generator).toSorted()).toEqual([
      "delta",
      "revision narrative",
    ]);
    expect(await readMarksRefs(second.pr)).toEqual({
      prevBase: BASE,
      newBase: OTHER_BASE,
    });
    expect(await countStartedRuns()).toBe(runsBefore + 1);
  });

  it("drops a stale shared key's marks before rewriting its narrative", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    await makeTask({ github })(second.payload);
    const retargeted = await retargetSecondHead(github, OTHER_BASE);
    const inner = stubGenerator();
    const generator = stubFailingDeltaGenerator(inner);

    const failed = makeTask({ github, generator })(retargeted.payload, {
      job: FIRST_ATTEMPT,
    });
    await expect(failed).rejects.toThrow("Connection error");

    expect(inner.calls).toContain("revision narrative");
    expect(await readMarksRefs(second.pr)).toBeUndefined();
  });

  it("reads a returning head's span from its highest-index Brief", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`, OTHER_BASE);
    arrangeForcePush(github);
    arrangeCompare(github, { base: OTHER_BASE, head: HEAD_1 }, A_PR_DIFF);
    const second = await pushSecondHead(github);
    await makeTask({ github })(second.payload);
    github.updatePullRequest(PR_REF, {
      headSha: HEAD_1,
      baseSha: OTHER_BASE,
      changedFiles: 1,
    });
    const returned = await trigger(HEAD_1, {
      githubUpdatedAt: new Date("2099-01-01T00:00:00Z"),
    });
    await makeTask({ github })(returned.payload);
    const callsBefore = listCompareSpans(github).length;
    const again = await retargetSecondHead(github, OTHER_BASE, {
      githubUpdatedAt: new Date("2099-01-02T00:00:00Z"),
    });

    await makeTask({ github })(again.payload);

    const spans = listCompareSpans(github).slice(callsBefore);
    expect(spans).toContain("e...a");
    expect(spans).not.toContain("c...a");
    expect(await readMarksRefs(second.pr)).toEqual({
      prevBase: OTHER_BASE,
      newBase: OTHER_BASE,
    });
  });

  it("rewrites a stored brief's narrative when its refs went stale", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    await makeTask({ github })(second.payload);
    const away = await retargetSecondHead(github, OTHER_BASE);
    await makeTask({ github })(away.payload);
    const back = await retargetSecondHead(github, BASE);
    const generator = stubGenerator();

    await makeTask({ github, generator })(back.payload);

    expect(generator.calls).not.toContain("brief");
    expect(listSpanCalls(generator).toSorted()).toEqual([
      "delta",
      "revision narrative",
    ]);
    expect(await readMarksRefs(second.pr)).toEqual({
      prevBase: BASE,
      newBase: BASE,
    });
  });

  it("skips every span artifact when the stored refs still hold", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    await makeTask({ github })(second.payload);
    const generator = stubGenerator();

    await makeTask({ github, generator })(second.payload);

    expect(listSpanCalls(generator)).toEqual([]);
  });

  it("keeps the stale refs when the narrative over them fails", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    await makeTask({ github })(second.payload);
    const away = await retargetSecondHead(github, OTHER_BASE);
    await makeTask({ github })(away.payload);
    const back = await retargetSecondHead(github, BASE);
    const generator = stubGenerator();
    generator.failNextWith = new Error("provider down");
    generator.outputs["delta"] = {
      summary: "delta over the new refs",
      commentsAddressed: "",
      changedGroups: [],
      chunks: [],
      wholePrImpact: "",
    };

    await makeTask({ github, generator })(back.payload);

    const { delta } = await readSpanBodies(second.pr);
    expect(await readMarksRefs(second.pr)).toEqual({
      prevBase: BASE,
      newBase: OTHER_BASE,
    });
    expect(listSpanCalls(generator)).toEqual([]);
    expect(delta.summary).toBe("stub delta");
  });

  it("writes no marks over a stored narrative when the narrative fails", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    await makeTask({ github })(second.payload);
    await createArtifactStore(harness.handle, ctx).comparisonMarks.delete(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    const again = await retargetSecondHead(github, BASE);
    const generator = stubGenerator();
    generator.failNextWith = new Error("provider down");

    await makeTask({ github, generator })(again.payload);

    expect(listSpanCalls(generator)).toEqual([]);
    expect(await readMarksRefs(second.pr)).toBeUndefined();
  });

  it("leaves no marks row when its write fails; the retry writes all three", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    await harness.raw(`
      create function refuse_marks() returns trigger language plpgsql as
        $$ begin raise exception 'marks write refused'; end $$
    `);
    await harness.raw(`
      create trigger refuse_marks before insert on comparison_marks
        for each row execute function refuse_marks()
    `);

    const failed = makeTask({ github })(second.payload, { job: FIRST_ATTEMPT });
    await expect(failed).rejects.toThrow('insert into "comparison_marks"');
    const afterFailure = await readSpanBodies(second.pr);
    await harness.raw("drop trigger refuse_marks on comparison_marks");
    await harness.raw("drop function refuse_marks()");
    const generator = stubGenerator();
    await makeTask({ github, generator })(second.payload);

    expect(afterFailure.marks).toBeUndefined();
    expect(afterFailure.narrative).toBeUndefined();
    expect(afterFailure.delta).toBeUndefined();
    expect(listSpanCalls(generator).toSorted()).toEqual([
      "delta",
      "revision narrative",
    ]);
    expect(await readMarksRefs(second.pr)).toEqual({
      prevBase: BASE,
      newBase: BASE,
    });
  });
});

describe("generate task, the revision marks beside a delta that stops", () => {
  it("writes the revision marks before a push stops the narrative", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    const inner = stubGenerator();
    let isBriefDone = false;
    const generator = stubHookedGenerator(inner, "brief", () => {
      isBriefDone = true;
    });
    pushHeadAfterEntryWrite(github, () => isBriefDone);

    await makeTask({ github, generator })(second.payload);

    const bodies = await readSpanBodies(second.pr);
    expect(await readRowStatus(second.pr, HEAD_2)).toBe(
      GenerationStatuses.SUPERSEDED,
    );
    expect(inner.calls).not.toContain("revision narrative");
    expect(bodies.narrative).toBeUndefined();
    expect(await readMarksRefs(second.pr)).toEqual({
      prevBase: BASE,
      newBase: BASE,
    });
  });

  it("keeps the revision marks when a push supersedes the delta call", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    const inner = stubGenerator();
    const generator = stubHookedGenerator(inner, "revision narrative", () => {
      github.updatePullRequest(PR_REF, { headSha: NEWER_HEAD });
    });

    await makeTask({ github, generator })(second.payload);

    const bodies = await readSpanBodies(second.pr);
    expect(await readRowStatus(second.pr, HEAD_2)).toBe(
      GenerationStatuses.SUPERSEDED,
    );
    expect(inner.calls).not.toContain("delta");
    expect(bodies.narrative).toBeDefined();
    expect(bodies.delta).toBeUndefined();
    expect(bodies.marks).toBeDefined();
  });

  it("keeps the revision marks past a failed delta; the retry pays the delta", async () => {
    const github = makeGitHub(HEAD_1);
    arrangePrDiffs(github, A_PR_DIFF, `${A_PR_DIFF}${C_PR_DIFF}`);
    const second = await pushSecondHead(github);
    const generator = stubFailingDeltaGenerator(stubGenerator());

    const failed = makeTask({ github, generator })(second.payload, {
      job: FIRST_ATTEMPT,
    });
    await expect(failed).rejects.toThrow("Connection error");
    const afterFailure = await readSpanBodies(second.pr);
    const retry = stubGenerator();
    await makeTask({ github, generator: retry })(second.payload);

    expect(afterFailure.narrative).toBeDefined();
    expect(afterFailure.delta).toBeUndefined();
    expect(afterFailure.marks).toBeDefined();
    expect(listSpanCalls(retry)).toEqual(["delta"]);
  });
});

describe("resolveSpanBaseline", () => {
  it("takes the base of the newest Brief of two at one head", () => {
    const rows = [
      { id: 1n, baseSha: BASE, headSha: HEAD_1, headIndex: 1 },
      { id: 2n, baseSha: OTHER_BASE, headSha: HEAD_1, headIndex: 2 },
      { id: 3n, baseSha: BASE, headSha: HEAD_2, headIndex: 3 },
    ].map((row) => ({ ...row, createdAt: new Date() }) as BriefSpanRow);

    expect(resolveSpanBaseline(rows, HEAD_1, BASE)).toEqual({
      headSha: HEAD_1,
      baseSha: OTHER_BASE,
    });
  });
});
