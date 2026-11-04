// A multi-call run in the worker: units claimed after grouping, parts stored
// as they land and resumed from, deleted once the brief is stored, kept on
// any failure but a permanent one over every part; the default branch's
// .gitattributes decides shortened files and whether a grouping is reusable.
import { buildFastForwardSpan } from "brief-core/pr-span";
import type { Brief } from "brief-core/types";
import {
  createArtifactStore,
  createGenerationPartStore,
  createGenerationProjection,
  createTenantRepository,
  GenerationPartKinds,
  ScopeViolationError,
  type PullRequestRow,
} from "persistence";
import {
  GeneratorError,
  GeneratorErrorKinds,
  type GenerateRequest,
  type Generator,
} from "generators";
import { FakeFailures, type FakeGitHub } from "github/testing";
import { createI18n } from "i18n";
import { claimTestRun } from "persistence/testing";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { CommentAnchorKinds, DiffSides } from "types/comments";
import { ChangeGroupCategories } from "types/reviews";
import { describe, expect, it, onTestFinished } from "vitest";
import type { z } from "zod/v4";
import { PermanentJobError } from "../../src/task/failure";
import {
  createMultiCallRun,
  digestAnchorPlan,
  digestGitAttributes,
} from "../../src/task/generate/logic/generation-parts";
import {
  GitAttributesReadings,
  HeadReadings,
  type RunContext,
} from "../../src/task/generate/types";
import {
  arrangeCompare,
  arrangeForcePush,
  BASE,
  buildRepoFile,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  interceptInstallationRepo,
  listCommentCalls,
  LAST_ATTEMPT,
  listRepoFilePaths,
  makeConnectionError,
  makeGitHub,
  makeInOrderGrouping,
  makeLargePoolTask,
  makeMultiCallGitHub,
  makeReviewerId,
  makeTarget,
  makeTask,
  MULTI_CALL_DIFF,
  MULTI_CALL_FILES,
  MULTI_CALL_GROUPING,
  MULTI_CALL_PATHS,
  PR_REF,
  PUBLIC_URL,
  readLiveBodies,
  REPO,
  SECOND_ATTEMPT,
  setUpHarness,
  stubGenerator,
  stubThreeGroupGenerator,
  trigger,
  type ThreeGroupStubGenerator,
} from "./helpers";

setUpHarness();

const MULTI_CALL_LABELS = ["grouping", "detail:1", "detail:2"];
const NO_GIT_ATTRIBUTES_DIGEST = digestGitAttributes(undefined);
/** A run with no previous brief plans no carry. */
const NO_ANCHOR_PLAN_DIGEST = digestAnchorPlan(undefined);
const REVIEWER_ID = 7_001n;

/** The next insert of `partKey` fails as a dropped connection does; the sequence outlives the aborted transaction. */
async function failNextPartWrite(partKey: string): Promise<void> {
  await harness.raw("create sequence part_write_faults");
  await harness.raw(
    `create function fail_part_write() returns trigger language plpgsql as $$ begin if new.part_key = '${partKey}' and nextval('part_write_faults') = 1 then raise exception 'connection terminated unexpectedly'; end if; return new; end $$`,
  );
  await harness.raw(
    "create trigger fail_part_write before insert on generation_part for each row execute function fail_part_write()",
  );
}

/** The run's first brief write fails as a dropped connection does; the parts it stored stay. */
async function failFirstBriefWrite(): Promise<void> {
  await harness.raw("create sequence brief_write_faults");
  await harness.raw(
    "create function fail_brief_write() returns trigger language plpgsql as $$ begin if nextval('brief_write_faults') = 1 then raise exception 'connection terminated unexpectedly'; end if; return new; end $$",
  );
  await harness.raw(
    "create trigger fail_brief_write before insert on brief for each row execute function fail_brief_write()",
  );
}

/** Every delete from `generation_part` fails as a dropped connection does. */
async function failPartDeletes(): Promise<void> {
  await harness.raw(
    "create function fail_part_delete() returns trigger language plpgsql as $$ begin raise exception 'connection terminated unexpectedly'; end $$",
  );
  await harness.raw(
    "create trigger fail_part_delete before delete on generation_part for each row execute function fail_part_delete()",
  );
}

async function allowPartDeletes(): Promise<void> {
  await harness.raw("drop trigger fail_part_delete on generation_part");
}

/** The run context the hooks read, for a claimed run driven at the hooks' seam. */
function stubRunContext(
  pr: PullRequestRow,
  projection: ReturnType<typeof createGenerationProjection>,
  runId: string,
  overrides: Record<string, unknown> = {},
): RunContext {
  const { logger } = captureLogger();
  return {
    deps: {},
    payload: { pullRequestId: pr.id, headSha: HEAD_1 },
    prInfo: { baseSha: BASE },
    parts: createGenerationPartStore(harness.handle, ctx),
    projection,
    target: makeTarget(pr, HEAD_1),
    run: { runId, leaveRow: false, providerCalls: 1 },
    repoSlug: "acme/widget",
    log: logger,
    ...overrides,
  } as unknown as RunContext;
}

/** The second Entry id swap of the run fails as the store throwing does. */
async function failSecondEntrySwap(): Promise<void> {
  await harness.raw("create sequence entry_swap_faults");
  await harness.raw(
    "create function fail_entry_swap() returns trigger language plpgsql as $$ begin if nextval('entry_swap_faults') = 2 then raise exception 'entry swap refused'; end if; return new; end $$",
  );
  await harness.raw(
    "create trigger fail_entry_swap before update on pull_request for each row when (old.entry_comment_id is distinct from new.entry_comment_id) execute function fail_entry_swap()",
  );
}

/**
 * The engine reads the generator's origin once, after the merge over every
 * detail call: a throw there stands in for a merge step failing for good
 * over the stored parts.
 */
function failMergeOnce(generator: ThreeGroupStubGenerator): Generator {
  let failures = 1;
  return {
    generate: (req) => generator.generate(req),
    origin(effort) {
      const merged = generator.calls.length >= MULTI_CALL_LABELS.length;
      if (merged && failures > 0) {
        failures -= 1;
        throw new Error("merge exploded");
      }
      return generator.origin(effort);
    },
  };
}

const FIVE_GROUP_PATHS = [
  "src/a.ts",
  "src/b.ts",
  "src/c.ts",
  "src/d.ts",
  "src/e.ts",
];

/** Two detail calls in flight at once: batches 2 and 3 of a five-group run share the pool. */
const TWO_IN_FLIGHT = 2;
const ONE_IN_FLIGHT = 1;

interface RecordedEdit {
  readonly commentId: bigint;
  readonly body: string;
}

/** Every in-place comment edit the fake takes from here on. */
function recordEdits(github: FakeGitHub): RecordedEdit[] {
  const edits: RecordedEdit[] = [];
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async editComment(commentId, body) {
      edits.push({ commentId, body });
      return client.editComment(commentId, body);
    },
  }));
  return edits;
}

/** How long a task that must wait for a held call gets to settle early. */
const EARLY_SETTLE_WINDOW_MS = 100;

/** Resolves `"pending"` after `ms`, for a race against a task that must not settle yet. */
function resolvePendingAfter(ms: number): Promise<"pending"> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("pending"), ms);
  });
}

interface AttemptRow {
  readonly units: number;
  readonly parts_done: number;
  readonly parts_total: number | null;
}

async function listAttempts(): Promise<AttemptRow[]> {
  const rows = await harness.raw(
    "select units, parts_done, parts_total from generation_attempt order by id",
  );
  return rows.map((row) => ({
    units: Number(row["units"]),
    parts_done: Number(row["parts_done"]),
    parts_total:
      row["parts_total"] === null ? null : Number(row["parts_total"]),
  }));
}

function makeSpan(pr: PullRequestRow, headSha = HEAD_1) {
  return { pullRequestId: pr.id, baseSha: BASE, headSha };
}

async function listPartKeys(
  pr: PullRequestRow,
  headSha = HEAD_1,
): Promise<string[]> {
  const parts = createGenerationPartStore(harness.handle, ctx);
  const rows = await parts.listForSpan(makeSpan(pr, headSha));
  return rows.map((row) => row.partKey);
}

/** Rewrites detail:1 to carry a risk attribute the run's repo config never defined: the store takes it, the engine does not. */
async function storeDetailPartWithDroppedAttribute(
  pr: PullRequestRow,
): Promise<void> {
  const parts = createGenerationPartStore(harness.handle, ctx);
  const rows = await parts.listForSpan(makeSpan(pr));
  const detail = rows.find((row) => row.partKey === "detail:1");
  if (detail?.body.kind !== GenerationPartKinds.DETAIL) {
    throw new Error("detail:1 missing");
  }
  const [first, ...rest] = detail.body.chunks;
  if (first === undefined) {
    throw new Error("detail:1 holds no chunk");
  }
  await parts.write({
    ...makeSpan(pr),
    partKey: "detail:1",
    body: {
      kind: GenerationPartKinds.DETAIL,
      chunks: [{ ...first, riskSurface: ["dropped-attribute"] }, ...rest],
    },
  });
}

/** A grouping part stored under both digests and one detail part, as a cut run leaves them. */
async function storeResumableParts(
  pr: PullRequestRow,
  gitAttributesDigest = NO_GIT_ATTRIBUTES_DIGEST,
  anchorPlanDigest = NO_ANCHOR_PLAN_DIGEST,
): Promise<void> {
  const parts = createGenerationPartStore(harness.handle, ctx);
  await parts.write({
    ...makeSpan(pr),
    partKey: "grouping",
    body: {
      kind: GenerationPartKinds.GROUPING,
      grouping: MULTI_CALL_GROUPING,
      gitAttributesDigest,
      anchorPlanDigest,
    },
  });
  await parts.write({
    ...makeSpan(pr),
    partKey: "detail:1",
    body: { kind: GenerationPartKinds.DETAIL, chunks: [] },
  });
}

async function readStoredBrief(pr: PullRequestRow) {
  return createArtifactStore(harness.handle, ctx).briefs.get(
    pr.id,
    BASE,
    HEAD_1,
  );
}

async function readStatus(pr: PullRequestRow) {
  const projection = createGenerationProjection(harness.handle, ctx);
  return projection.get(makeTarget(pr, HEAD_1));
}

/** The three-group stub, whose single call also groups each `src/` file as the grouping fixture does. */
function stubSourceBriefGenerator(): Generator {
  const base = stubThreeGroupGenerator();
  return {
    origin: (effort) => base.origin(effort),
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      const answer: unknown = await base.generate(req);
      if (
        req.label !== "brief" ||
        typeof answer !== "object" ||
        answer === null
      ) {
        return req.schema.parse(answer);
      }
      return req.schema.parse({
        ...answer,
        changeGroups: MULTI_CALL_GROUPING.changeGroups,
        chunks: MULTI_CALL_PATHS.map((file, position) => ({
          id: `c${position + 1}`,
          changeGroupId: `g${position + 1}`,
          file,
          concern: "implementation",
          role: "core",
          loc: { added: 1, deleted: 1 },
          addedRanges: [{ start: 1, end: 1 }],
          removedRanges: [{ start: 1, end: 1 }],
          riskSurface: [],
        })),
      });
    },
  };
}

/** A file the force push adds to the PR; adding one reads no blob. */
const D_FILE_DIFF = `diff --git a/src/d.ts b/src/d.ts
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/src/d.ts
@@ -0,0 +1,2 @@
+one
+two
`;

/** The group ids a Brief's chunks on `file` name, in chunk order, once each. */
function readChunkFileGroups(brief: Brief, file: string): string[] {
  const chunks = brief.chunks.filter((chunk) => chunk.file === file);
  return [...new Set(chunks.map((chunk) => chunk.changeGroupId))];
}

/** Two multi-call pushes of one PR, HEAD_1 then HEAD_2; both stored rows. */
async function runTwoMultiCallPushes() {
  const first = await trigger(HEAD_1);
  await makeTask({
    generator: stubThreeGroupGenerator(),
    github: makeMultiCallGitHub(HEAD_1),
    forceMultiCall: true,
  })(first.payload);
  const second = await trigger(HEAD_2);
  await makeTask({
    generator: stubThreeGroupGenerator(),
    github: makeMultiCallGitHub(HEAD_2),
    forceMultiCall: true,
  })(second.payload);

  const store = createArtifactStore(harness.handle, ctx);
  const previous = await store.briefs.get(first.pr.id, BASE, HEAD_1);
  const current = await store.briefs.get(second.pr.id, BASE, HEAD_2);
  if (previous === undefined || current === undefined) {
    throw new Error("a push stored no brief");
  }
  return { previous, current };
}

describe("a multi-call run", () => {
  it("claims a unit per detail call and deletes the parts after the write", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubThreeGroupGenerator();
    const task = makeTask({
      generator,
      github: makeMultiCallGitHub(HEAD_1),
      forceMultiCall: true,
      spend: { maxGenerationsPerDay: 10 },
    });

    await task(payload);

    expect(generator.calls.slice(0, 3)).toEqual(MULTI_CALL_LABELS);
    expect(await listAttempts()).toEqual([
      { units: 3, parts_done: 2, parts_total: 2 },
    ]);
    expect(await listPartKeys(pr)).toEqual([]);
    const brief = await readStoredBrief(pr);
    expect(brief).toBeDefined();
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      outlineForm: "full",
      changeGroups: [{ id: "g1" }, { id: "g2" }, { id: "g3" }],
    });
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("edits the generating Entry in place after grouping, no repost", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const posted: string[] = [];
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async postEntryComment(input) {
        posted.push(input.body);
        return client.postEntryComment(input);
      },
    }));
    const edits = recordEdits(github);

    await makeTask({
      generator: stubThreeGroupGenerator(),
      github,
      forceMultiCall: true,
      detailConcurrency: 1,
    })(payload);

    expect(posted).toHaveLength(2);
    expect(posted[0]).toContain("Brief is generating");
    expect(posted[0]).not.toContain("parts");
    expect(posted[1]).toContain("Read the brief for this push");
    expect(edits).toHaveLength(1);
    expect(edits[0]?.body).toContain(
      "A large pull request: this brief is generated in 2 parts. Expect it in about 10 minutes.",
    );
    expect(listCommentCalls(github).slice(0, 2)).toEqual([
      "post",
      `edit:${edits[0]?.commentId}`,
    ]);
  });

  it("leaves the generating Entry when the head read fails at grouping", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    let callsAtDetail: string[] = [];
    generator.onCall = async (label) => {
      if (label === "grouping") {
        github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
      }
      if (label === "detail:1") {
        callsAtDetail = listCommentCalls(github);
      }
    };
    const edits = recordEdits(github);

    await makeTask({
      generator,
      github,
      forceMultiCall: true,
      detailConcurrency: 1,
    })(payload);

    expect(callsAtDetail).toEqual(["post"]);
    expect(edits).toEqual([]);
  });

  it("estimates a resumed run's time over its missing detail calls", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1, FIVE_GROUP_PATHS);
    const grouping = makeInOrderGrouping(FIVE_GROUP_PATHS.length);
    const generator = stubThreeGroupGenerator(grouping);
    generator.failOn("detail:3", makeConnectionError());
    const options = {
      github,
      forceMultiCall: true,
      detailConcurrency: ONE_IN_FLIGHT,
    };
    await expect(makeTask({ generator, ...options })(payload)).rejects.toThrow(
      "Connection error",
    );
    const edits = recordEdits(github);

    const resumed = stubThreeGroupGenerator(grouping);
    await makeTask({ generator: resumed, ...options })(payload, {
      job: SECOND_ATTEMPT,
    });

    expect(resumed.calls).toContain("detail:3");
    expect(edits.map((edit) => edit.body)).toEqual([
      expect.stringContaining(
        "generated in 3 parts. Expect it in about 10 minutes.",
      ),
    ]);
  });

  it("goes on when the large Entry's fallback repost cannot store its id", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    // The generating comment is gone when the edit lands, so it reposts.
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async editComment(commentId, body) {
        await client.deleteComment(commentId);
        return client.editComment(commentId, body);
      },
    }));
    await failSecondEntrySwap();
    const { logger, readLines } = captureLogger();
    const generator = stubThreeGroupGenerator();

    await makeTask({
      generator,
      github,
      forceMultiCall: true,
      detailConcurrency: 1,
      log: logger,
    })(payload);

    expect(generator.calls.slice(0, 3)).toEqual(MULTI_CALL_LABELS);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
    const warned = readLines().find((line) =>
      String(line["msg"]).includes("generating Entry was not edited"),
    );
    expect(warned?.["level"]).toBe("warn");
    expect(readLiveBodies(github).join("\n")).toContain(
      "Read the brief for this push",
    );
  });

  it("ends the run for good when the parts plan is a caller's bug", async () => {
    const { pr } = await trigger(HEAD_1);
    const projection = createGenerationProjection(harness.handle, ctx);
    const runId = await claimTestRun(projection, makeTarget(pr, HEAD_1));
    const context = stubRunContext(pr, projection, runId, {
      projection: {
        ...projection,
        recordPartsPlanned: () =>
          Promise.reject(new RangeError("a plan counts whole parts")),
      },
    });
    const { hooks } = createMultiCallRun(context, runId, {
      kind: GitAttributesReadings.NONE,
    });

    await expect(
      hooks.onGroupingDone?.({ detailCalls: 2, missingDetailCalls: [1, 2] }),
    ).rejects.toBeInstanceOf(PermanentJobError);
  });

  it("ends the run when the generating Entry edit meets a scope refusal", async () => {
    const { pr } = await trigger(HEAD_1);
    const projection = createGenerationProjection(harness.handle, ctx);
    const runId = await claimTestRun(projection, makeTarget(pr, HEAD_1));
    const context = stubRunContext(pr, projection, runId, {
      deps: { translate: createI18n().t },
      run: {
        runId,
        leaveRow: false,
        providerCalls: 1,
        entryCommentAllowed: true,
      },
      priorBriefs: [],
      watch: {
        readHead: () => Promise.resolve({ kind: HeadReadings.CURRENT }),
        isPinned: () => false,
      },
      entryCommentManager: {
        buildDeepLink: () => ({
          publicBaseUrl: PUBLIC_URL,
          repoId: pr.repoId,
          prNumber: pr.prNumber,
          headIndex: 1,
          headSha: HEAD_1,
        }),
        edit: () =>
          Promise.reject(
            new ScopeViolationError("pull_request", pr.id, "installation 42"),
          ),
      },
    });
    const { hooks } = createMultiCallRun(context, runId, {
      kind: GitAttributesReadings.NONE,
    });

    await expect(
      hooks.onGroupingDone?.({ detailCalls: 2, missingDetailCalls: [1, 2] }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it("ends capped at the grouping when the detail calls do not fit the day", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubThreeGroupGenerator();
    const github = makeMultiCallGitHub(HEAD_1);
    const { logger, readLines } = captureLogger();
    const task = makeTask({
      generator,
      github,
      forceMultiCall: true,
      spend: { maxGenerationsPerDay: 2 },
      log: logger,
    });

    await expect(task(payload)).resolves.toBeUndefined();

    expect(generator.calls).toEqual(["grouping"]);
    expect(await readStatus(pr)).toMatchObject({
      status: GenerationStatuses.CAPPED,
      errorParams: { needed: 2, left: 1, cap: 2 },
    });
    expect(await listAttempts()).toEqual([
      { units: 1, parts_done: 0, parts_total: null },
    ]);
    expect(await listPartKeys(pr)).toEqual(["grouping"]);
    expect(await readStoredBrief(pr)).toBeUndefined();
    const lines = readLines();
    expect(lines.some((line) => line["evt"] === "job.fail")).toBe(false);
    expect(
      lines.some((line) => String(line["msg"]).includes("held by another run")),
    ).toBe(false);
    expect(readLiveBodies(github).join("\n")).not.toContain(
      "generation failed",
    );
  });

  it("fails transient when a part write fails after a paid call and resumes", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    await failNextPartWrite("detail:1");
    const generator = stubThreeGroupGenerator();
    const task = makeTask({ generator, github, forceMultiCall: true });

    await expect(task(payload)).rejects.toThrow(
      'insert into "generation_part"',
    );

    expect(generator.calls).toEqual(["grouping", "detail:1"]);
    expect(await readStatus(pr)).toMatchObject({
      status: GenerationStatuses.FAILED,
      errorCode: "unknown",
    });
    expect(await listPartKeys(pr)).toEqual(["grouping"]);
    expect(await listAttempts()).toEqual([
      { units: 3, parts_done: 0, parts_total: 2 },
    ]);
    expect(readLiveBodies(github).join("\n")).not.toContain(
      "generation failed",
    );

    const resumed = stubThreeGroupGenerator();
    await makeTask({ generator: resumed, github, forceMultiCall: true })(
      payload,
      { job: SECOND_ATTEMPT },
    );

    expect(resumed.calls.slice(0, 2)).toEqual(["detail:1", "detail:2"]);
    expect(await listAttempts()).toEqual([
      { units: 3, parts_done: 0, parts_total: 2 },
      { units: 3, parts_done: 2, parts_total: 2 },
    ]);
    expect(await listPartKeys(pr)).toEqual([]);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("deletes the parts when the merge over every part fails for good", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    const task = makeTask({
      generator: failMergeOnce(generator),
      github,
      forceMultiCall: true,
    });

    await expect(task(payload)).resolves.toBeUndefined();

    expect(generator.calls).toEqual(MULTI_CALL_LABELS);
    expect(await readStatus(pr)).toMatchObject({
      status: GenerationStatuses.FAILED,
      errorCode: "unknown",
    });
    expect(await listPartKeys(pr)).toEqual([]);

    const regenerated = stubThreeGroupGenerator();
    await makeTask({ generator: regenerated, github, forceMultiCall: true })(
      payload,
      { job: SECOND_ATTEMPT },
    );

    expect(regenerated.calls.slice(0, 3)).toEqual(MULTI_CALL_LABELS);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("re-sends a detail call stored under a grouping that then ran fresh", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    await failFirstBriefWrite();
    const first = stubThreeGroupGenerator();

    await expect(
      makeTask({ generator: first, github, forceMultiCall: true })(payload),
    ).rejects.toThrow('insert into "brief"');

    expect(await listPartKeys(pr)).toEqual([
      "grouping",
      "detail:1",
      "detail:2",
    ]);

    // The engine reuses a stored grouping that parses, so the second run is
    // driven at the hooks' seam as a run whose grouping call ran fresh.
    const projection = createGenerationProjection(harness.handle, ctx);
    const target = makeTarget(pr, HEAD_1);
    const runId = await claimTestRun(projection, target);
    const second = createMultiCallRun(
      stubRunContext(pr, projection, runId),
      runId,
      { kind: GitAttributesReadings.NONE },
    );
    await second.loadStoredParts(undefined);
    await second.hooks.onPartDone?.("grouping", MULTI_CALL_GROUPING);
    await second.hooks.onGroupingDone?.({
      detailCalls: 2,
      missingDetailCalls: [1, 2],
    });
    await second.hooks.onPartDone?.("detail:1", { chunks: [] });
    await projection.finishRun(target, runId, {
      status: GenerationStatuses.FAILED,
      failure: { code: GenerationFailureCodes.PROVIDER_UNAVAILABLE },
    });

    expect(await listPartKeys(pr)).toEqual(["grouping", "detail:1"]);
    expect((await listAttempts()).at(-1)?.units).toBe(3);

    const third = stubThreeGroupGenerator();
    await makeTask({ generator: third, github, forceMultiCall: true })(
      payload,
      { job: SECOND_ATTEMPT },
    );

    expect(third.calls.slice(0, 1)).toEqual(["detail:2"]);
    expect(third.calls).not.toContain("grouping");
    expect(third.calls).not.toContain("detail:1");
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(await listPartKeys(pr)).toEqual([]);
  });

  it("stamps a multi-call brief over an anchored previous row as anchored", async () => {
    const first = await trigger(HEAD_1);
    await makeTask({ generator: stubGenerator(), github: makeGitHub(HEAD_1) })(
      first.payload,
    );
    const second = await trigger(HEAD_2);

    await makeTask({
      generator: stubThreeGroupGenerator(),
      github: makeMultiCallGitHub(HEAD_2),
      forceMultiCall: true,
    })(second.payload);

    const row = await createArtifactStore(harness.handle, ctx).briefs.get(
      second.pr.id,
      BASE,
      HEAD_2,
    );
    const hops = await createArtifactStore(
      harness.handle,
      ctx,
    ).hunkSpans.listForPullRequest(second.pr.id);
    expect(row?.anchorState).toBe("anchored");
    expect(row?.anchorReason).toBeNull();
    expect(JSON.parse(row?.body ?? "{}")).toMatchObject({
      anchor: { state: "anchored" },
    });
    expect(hops.map((hop) => [hop.baselineSha, hop.headSha])).toEqual([
      [HEAD_1, HEAD_2],
    ]);
    expect(row?.usedGroupIds).toContain("g1");
  });

  it("anchors a single-call brief over a multi-call previous row", async () => {
    const first = await trigger(HEAD_1);
    await makeTask({
      generator: stubThreeGroupGenerator(),
      github: makeMultiCallGitHub(HEAD_1),
      forceMultiCall: true,
    })(first.payload);
    const second = await trigger(HEAD_2);

    await makeTask({
      generator: stubGenerator(),
      github: makeGitHub(HEAD_2),
    })(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(second.pr.id, BASE, HEAD_2);
    const hops = await store.hunkSpans.listForPullRequest(second.pr.id);
    expect(row?.anchorState).toBe("anchored");
    expect(hops.map((hop) => [hop.baselineSha, hop.headSha])).toEqual([
      [HEAD_1, HEAD_2],
    ]);
  });

  it.each([
    ["multi", "single"],
    ["single", "multi"],
  ])(
    "carries frozen ids across a force push from %s-call to %s-call",
    async (from, to) => {
      const first = await trigger(HEAD_1);
      await makeTask({
        generator: stubSourceBriefGenerator(),
        github: makeMultiCallGitHub(HEAD_1),
        forceMultiCall: from === "multi",
      })(first.payload);
      const second = await trigger(HEAD_2);
      const amended = `${MULTI_CALL_DIFF}${D_FILE_DIFF}`;
      const github = makeGitHub(
        HEAD_2,
        [...MULTI_CALL_FILES, { path: "src/d.ts", additions: 2, deletions: 0 }],
        amended,
      );
      arrangeCompare(github, { base: BASE, head: HEAD_1 }, MULTI_CALL_DIFF);
      arrangeCompare(github, { base: BASE, head: HEAD_2 }, amended);
      arrangeForcePush(github);
      github.updatePullRequest(PR_REF, { changedFiles: 4 });
      github.addRepoFile(
        REPO,
        { path: "src/d.ts", ref: HEAD_2 },
        buildRepoFile("one\ntwo\n", "4444444"),
      );

      await makeTask({
        generator: stubSourceBriefGenerator(),
        github,
        forceMultiCall: to === "multi",
      })(second.payload);

      const store = createArtifactStore(harness.handle, ctx);
      const previous = await store.briefs.get(first.pr.id, BASE, HEAD_1);
      const row = await store.briefs.get(second.pr.id, BASE, HEAD_2);
      const hops = await store.hunkSpans.listForPullRequest(second.pr.id);
      const previousBody = JSON.parse(previous?.body ?? "{}") as Brief;
      const body = JSON.parse(row?.body ?? "{}") as Brief;
      expect(row?.anchorState).toBe("anchored");
      expect(hops.map((hop) => [hop.baselineSha, hop.headSha])).toEqual([
        [HEAD_1, HEAD_2],
      ]);
      expect(body.outlineForm === undefined).toBe(to === "single");
      expect(readChunkFileGroups(body, "src/a.ts")).toEqual(
        readChunkFileGroups(previousBody, "src/a.ts"),
      );
      expect(row?.carriedChunkIds?.length).toBeGreaterThan(0);
    },
  );

  it("starts over when a stored part is off the shape the store accepts", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await harness.raw(
      `insert into generation_part (installation_id, pull_request_id, base_sha, head_sha, part_key, body) values (42, ${pr.id}, '${BASE}', '${HEAD_1}', 'grouping', '{"kind":"grouping"}')`,
    );
    const generator = stubThreeGroupGenerator();

    await makeTask({
      generator,
      github: makeMultiCallGitHub(HEAD_1),
      forceMultiCall: true,
    })(payload);

    expect(generator.calls.slice(0, 3)).toEqual(MULTI_CALL_LABELS);
    expect(await listPartKeys(pr)).toEqual([]);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("keeps the stored parts and retries when .gitattributes cannot be read", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const parts = createGenerationPartStore(harness.handle, ctx);
    await parts.write({
      ...makeSpan(pr),
      partKey: "grouping",
      body: {
        kind: GenerationPartKinds.GROUPING,
        grouping: MULTI_CALL_GROUPING,
        gitAttributesDigest: NO_GIT_ATTRIBUTES_DIGEST,
        anchorPlanDigest: NO_ANCHOR_PLAN_DIGEST,
      },
    });
    await parts.write({
      ...makeSpan(pr),
      partKey: "detail:1",
      body: { kind: GenerationPartKinds.DETAIL, chunks: [] },
    });
    const github = makeMultiCallGitHub(HEAD_1);
    github.failRepoFile(
      REPO,
      { path: ".gitattributes" },
      FakeFailures.SERVER_ERROR,
    );
    const generator = stubThreeGroupGenerator();

    await expect(
      makeTask({ generator, github, forceMultiCall: true })(payload),
    ).rejects.toThrow(".gitattributes unread");

    expect(generator.calls).toEqual([]);
    expect(await readStatus(pr)).toMatchObject({
      status: GenerationStatuses.FAILED,
      errorCode: "github-unavailable",
    });
    expect(await listPartKeys(pr)).toEqual(["grouping", "detail:1"]);
    expect(await listAttempts()).toEqual([
      { units: 1, parts_done: 0, parts_total: null },
    ]);
  });

  it("fails transient before a single call over parts it cannot tell apart", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await storeResumableParts(pr);
    const github = makeMultiCallGitHub(HEAD_1);
    github.failRepoFile(
      REPO,
      { path: ".gitattributes" },
      FakeFailures.SERVER_ERROR,
    );
    const generator = stubThreeGroupGenerator();

    await expect(makeTask({ generator, github })(payload)).rejects.toThrow(
      ".gitattributes unread",
    );

    expect(generator.calls).toEqual([]);
    expect(await readStatus(pr)).toMatchObject({
      status: GenerationStatuses.FAILED,
      errorCode: "github-unavailable",
    });
    expect(await listPartKeys(pr)).toEqual(["grouping", "detail:1"]);
  });

  it("fails transient before a single call when the part store fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await storeResumableParts(
      pr,
      digestGitAttributes("*.lock linguist-generated\n"),
    );
    await failPartDeletes();
    const generator = stubThreeGroupGenerator();

    await expect(
      makeTask({ generator, github: makeMultiCallGitHub(HEAD_1) })(payload),
    ).rejects.toThrow('delete from "generation_part"');

    expect(generator.calls).toEqual([]);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.FAILED);
  });

  it("briefs in one call on an unread .gitattributes with no stored part", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    github.failRepoFile(
      REPO,
      { path: ".gitattributes" },
      FakeFailures.SERVER_ERROR,
    );
    const generator = stubThreeGroupGenerator();

    await makeTask({ generator, github })(payload);

    expect(generator.calls.slice(0, 1)).toEqual(["brief"]);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("stores no digest of a .gitattributes it failed to read", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const refusing = makeMultiCallGitHub(HEAD_1);
    refusing.failRepoFile(
      REPO,
      { path: ".gitattributes" },
      FakeFailures.SERVER_ERROR,
    );
    const first = stubThreeGroupGenerator();

    await expect(
      makeTask({ generator: first, github: refusing, forceMultiCall: true })(
        payload,
      ),
    ).rejects.toThrow(".gitattributes unread");

    expect(first.calls).toEqual([]);
    expect(await listPartKeys(pr)).toEqual([]);

    const second = stubThreeGroupGenerator();
    await makeTask({
      generator: second,
      github: makeMultiCallGitHub(HEAD_1),
      forceMultiCall: true,
    })(payload, { job: SECOND_ATTEMPT });

    expect(second.calls.slice(0, 3)).toEqual(MULTI_CALL_LABELS);
    expect(await listAttempts()).toEqual([
      { units: 1, parts_done: 0, parts_total: null },
      { units: 3, parts_done: 2, parts_total: 2 },
    ]);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it.each([
    ["a symlink", FakeFailures.NOT_A_BLOB],
    ["bytes that are not UTF-8", FakeFailures.NOT_TEXT],
    ["a 403", FakeFailures.FORBIDDEN],
  ])(
    "briefs in full when GitHub serves .gitattributes as %s",
    async (_label, failure) => {
      const { pr, payload } = await trigger(HEAD_1);
      const github = makeMultiCallGitHub(HEAD_1);
      github.failRepoFile(REPO, { path: ".gitattributes" }, failure);
      const generator = stubThreeGroupGenerator();
      const { logger, readLines } = captureLogger();

      await makeTask({ generator, github, forceMultiCall: true, log: logger })(
        payload,
      );

      expect(generator.calls.slice(0, 3)).toEqual(MULTI_CALL_LABELS);
      expect(await listAttempts()).toEqual([
        { units: 3, parts_done: 2, parts_total: 2 },
      ]);
      expect(await listPartKeys(pr)).toEqual([]);
      expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
      const refusal = readLines().find((line) =>
        String(line["msg"]).includes(".gitattributes refused"),
      );
      expect(refusal?.["level"]).toBe("warn");
    },
  );

  it("starts over on a grouping part stored under another .gitattributes", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const parts = createGenerationPartStore(harness.handle, ctx);
    await parts.write({
      ...makeSpan(pr),
      partKey: "grouping",
      body: {
        kind: GenerationPartKinds.GROUPING,
        grouping: MULTI_CALL_GROUPING,
        gitAttributesDigest: digestGitAttributes(
          "src/c.ts linguist-generated\n",
        ),
        anchorPlanDigest: NO_ANCHOR_PLAN_DIGEST,
      },
    });
    await parts.write({
      ...makeSpan(pr),
      partKey: "detail:1",
      body: { kind: GenerationPartKinds.DETAIL, chunks: [] },
    });
    const generator = stubThreeGroupGenerator();

    await makeTask({
      generator,
      github: makeMultiCallGitHub(HEAD_1),
      forceMultiCall: true,
    })(payload);

    expect(generator.calls.slice(0, 3)).toEqual(MULTI_CALL_LABELS);
    expect(await listAttempts()).toEqual([
      { units: 3, parts_done: 2, parts_total: 2 },
    ]);
    expect(await listPartKeys(pr)).toEqual([]);
  });

  it("starts over on a grouping part stored under another anchor plan", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await storeResumableParts(
      pr,
      NO_GIT_ATTRIBUTES_DIGEST,
      digestGitAttributes("another plan"),
    );
    const generator = stubThreeGroupGenerator();

    await makeTask({
      generator,
      github: makeMultiCallGitHub(HEAD_1),
      forceMultiCall: true,
    })(payload);

    expect(generator.calls.slice(0, 3)).toEqual(MULTI_CALL_LABELS);
    expect(await listPartKeys(pr)).toEqual([]);
  });

  it("digests the previous brief's head and index beside its plan", async () => {
    const first = await trigger(HEAD_1);
    await makeTask({ generator: stubGenerator(), github: makeGitHub(HEAD_1) })(
      first.payload,
    );
    const row = await readStoredBrief(first.pr);
    const brief = JSON.parse(row?.body ?? "{}") as Brief;
    const span = buildFastForwardSpan({
      betweenHeadsDiff: "",
      newPrDiff: "",
    });

    const digest = digestAnchorPlan({ brief, span });
    const otherHead = digestAnchorPlan({
      brief: { ...brief, commitRange: { ...brief.commitRange, head: HEAD_2 } },
      span,
    });
    const otherIndex = digestAnchorPlan({
      brief: { ...brief, index: brief.index + 1 },
      span,
    });

    expect(new Set([digest, otherHead, otherIndex]).size).toBe(3);
  });

  it("resumes an anchored grouping part stored under the same plan", async () => {
    const first = await trigger(HEAD_1);
    await makeTask({ generator: stubGenerator(), github: makeGitHub(HEAD_1) })(
      first.payload,
    );
    const second = await trigger(HEAD_2);
    const github = makeMultiCallGitHub(HEAD_2);
    const failing = stubThreeGroupGenerator();
    failing.failOn("detail:1", makeConnectionError());

    await expect(
      makeTask({ generator: failing, github, forceMultiCall: true })(
        second.payload,
      ),
    ).rejects.toThrow("Connection error");
    expect(await listPartKeys(second.pr, HEAD_2)).toContain("grouping");

    const resumed = stubThreeGroupGenerator();
    await makeTask({ generator: resumed, github, forceMultiCall: true })(
      second.payload,
      { job: SECOND_ATTEMPT },
    );

    const row = await createArtifactStore(harness.handle, ctx).briefs.get(
      second.pr.id,
      BASE,
      HEAD_2,
    );
    expect(resumed.calls).not.toContain("grouping");
    expect(resumed.calls).toContain("detail:1");
    expect(row?.anchorState).toBe("anchored");
  });

  it("carries a group reclassification across a multi-call chain", async () => {
    const { previous, current } = await runTwoMultiCallPushes();
    const sessions = createTenantRepository(harness.handle, ctx).reviewSessions;
    const reviewerId = makeReviewerId(REVIEWER_ID);
    await sessions.reclassifyGroup(
      { briefId: previous.id, reviewerId },
      { changeGroupId: "g1", category: ChangeGroupCategories.BUGFIX },
    );

    const view = await sessions.preview({ briefId: current.id, reviewerId });

    expect(current.anchorState).toBe("anchored");
    expect(
      view.ok &&
        view.value.carried.reclassifications.map((row) => row.changeGroupId),
    ).toEqual(["g1"]);
  });

  it("keeps a draft line anchor across a multi-call push", async () => {
    const { previous, current } = await runTwoMultiCallPushes();
    const sessions = createTenantRepository(harness.handle, ctx).reviewSessions;
    const reviewerId = makeReviewerId(REVIEWER_ID);
    await sessions.addDraft(
      { briefId: previous.id, reviewerId },
      {
        anchor: {
          kind: CommentAnchorKinds.LINE,
          file: "src/a.ts",
          side: DiffSides.NEW,
          startLine: 1,
          endLine: 1,
        },
        body: "check this line",
      },
    );

    const view = await sessions.preview({ briefId: current.id, reviewerId });

    expect(view.ok && view.value.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({ file: "src/a.ts", startLine: 1 }),
        anchorStatus: null,
      }),
    ]);
  });

  it("fails a cut grouping call for good as output-cut", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubThreeGroupGenerator();
    generator.failOn(
      "grouping",
      new GeneratorError(GeneratorErrorKinds.OUTPUT_CUT, "grouping cut"),
    );

    await expect(
      makeTask({
        generator,
        github: makeMultiCallGitHub(HEAD_1),
        forceMultiCall: true,
      })(payload),
    ).resolves.toBeUndefined();

    expect(generator.calls).toEqual(["grouping"]);
    expect(await readStatus(pr)).toMatchObject({
      status: GenerationStatuses.FAILED,
      errorCode: "output-cut",
    });
    expect(await listPartKeys(pr)).toEqual([]);
  });

  it("keeps the finished parts on a transient detail failure and resumes", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    generator.failOn("detail:2", makeConnectionError());
    const task = makeTask({ generator, github, forceMultiCall: true });

    await expect(task(payload)).rejects.toThrow("Connection error");

    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.FAILED);
    expect(await listPartKeys(pr)).toEqual(["grouping", "detail:1"]);
    expect(await listAttempts()).toEqual([
      { units: 3, parts_done: 1, parts_total: 2 },
    ]);

    const resumed = stubThreeGroupGenerator();
    await makeTask({ generator: resumed, github, forceMultiCall: true })(
      payload,
      { job: SECOND_ATTEMPT },
    );

    expect(resumed.calls.slice(0, 1)).toEqual(["detail:2"]);
    expect(await listAttempts()).toEqual([
      { units: 3, parts_done: 1, parts_total: 2 },
      { units: 2, parts_done: 2, parts_total: 2 },
    ]);
    expect(await listPartKeys(pr)).toEqual([]);
    expect(await readStoredBrief(pr)).toBeDefined();
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("lets a held detail call finish and store when another fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1, FIVE_GROUP_PATHS);
    const grouping = makeInOrderGrouping(FIVE_GROUP_PATHS.length);
    const generator = stubThreeGroupGenerator(grouping);
    generator.failOn("detail:3", makeConnectionError());
    let releaseHeld = (): void => {};
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    onTestFinished(() => releaseHeld());
    let markFailingCallStarted = (): void => {};
    const failingCallStarted = new Promise<void>((resolve) => {
      markFailingCallStarted = resolve;
    });
    generator.onCall = async (label) => {
      if (label === "detail:3") {
        markFailingCallStarted();
      }
      if (label === "detail:2") {
        await held;
      }
    };
    const run = makeTask({
      generator,
      github,
      forceMultiCall: true,
      detailConcurrency: TWO_IN_FLIGHT,
    })(payload);
    const outcome = run.then(
      () => "resolved",
      () => "rejected",
    );

    await failingCallStarted;
    const early = await Promise.race([
      outcome,
      resolvePendingAfter(EARLY_SETTLE_WINDOW_MS),
    ]);
    expect(early).toBe("pending");
    releaseHeld();
    await expect(run).rejects.toThrow("Connection error");

    expect(await listPartKeys(pr)).toEqual([
      "grouping",
      "detail:1",
      "detail:2",
    ]);

    const resumed = stubThreeGroupGenerator(grouping);
    await makeTask({
      generator: resumed,
      github,
      forceMultiCall: true,
      detailConcurrency: TWO_IN_FLIGHT,
    })(payload, { job: SECOND_ATTEMPT });

    const resumedDetailCalls = resumed.calls.filter((label) =>
      label.startsWith("detail:"),
    );
    expect(resumedDetailCalls).toEqual(["detail:3"]);
    expect(await listAttempts()).toEqual([
      { units: 4, parts_done: 2, parts_total: 3 },
      { units: 2, parts_done: 3, parts_total: 3 },
    ]);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("fails the run for good on a refused detail call and keeps the parts", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    generator.failOn(
      "detail:2",
      new GeneratorError(GeneratorErrorKinds.REFUSAL, "refused"),
    );
    const task = makeTask({ generator, github, forceMultiCall: true });

    await expect(task(payload)).resolves.toBeUndefined();

    expect(await readStatus(pr)).toMatchObject({
      status: GenerationStatuses.FAILED,
      errorCode: "provider-refusal",
    });
    expect(await listPartKeys(pr)).toEqual(["grouping", "detail:1"]);
    expect(await readStoredBrief(pr)).toBeUndefined();
    const failed = readLiveBodies(github).find((body) =>
      body.includes("No brief for `aaaaaaa`: generation failed."),
    );
    expect(failed).toBeDefined();
  });

  it("claims and keeps a stored detail part the engine no longer accepts", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    generator.failOn("detail:2", makeConnectionError());
    await expect(
      makeTask({ generator, github, forceMultiCall: true })(payload),
    ).rejects.toThrow("Connection error");
    await storeDetailPartWithDroppedAttribute(pr);

    const resumed = stubThreeGroupGenerator();
    resumed.failOn(
      "detail:2",
      new GeneratorError(GeneratorErrorKinds.REFUSAL, "refused"),
    );
    await makeTask({ generator: resumed, github, forceMultiCall: true })(
      payload,
      { job: SECOND_ATTEMPT },
    );

    expect(resumed.calls.slice(0, 2)).toEqual(["detail:1", "detail:2"]);
    expect(await listAttempts()).toEqual([
      { units: 3, parts_done: 1, parts_total: 2 },
      { units: 3, parts_done: 1, parts_total: 2 },
    ]);
    expect(await readStatus(pr)).toMatchObject({
      status: GenerationStatuses.FAILED,
      errorCode: "provider-refusal",
    });
    expect(await listPartKeys(pr)).toEqual(["grouping", "detail:1"]);
  });

  it("keeps the parts on a shutdown and the retry pays only the missing call", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    const generator = stubThreeGroupGenerator();
    const shutdown = new AbortController();
    generator.onCall = async (label) => {
      if (label === "detail:2") {
        shutdown.abort();
      }
    };
    const task = makeTask({ generator, github, forceMultiCall: true });

    await expect(
      task(payload, { abortSignal: shutdown.signal }),
    ).rejects.toThrow("aborted");

    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.PENDING);
    expect(await listPartKeys(pr)).toEqual(["grouping", "detail:1"]);

    const resumed = stubThreeGroupGenerator();
    await makeTask({ generator: resumed, github, forceMultiCall: true })(
      payload,
      { job: SECOND_ATTEMPT },
    );

    expect(resumed.calls.slice(0, 1)).toEqual(["detail:2"]);
    expect(await listAttempts()).toEqual([
      { units: 3, parts_done: 1, parts_total: 2 },
      { units: 2, parts_done: 2, parts_total: 2 },
    ]);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("ends failed on the last attempt's shutdown with the parts kept", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubThreeGroupGenerator();
    const shutdown = new AbortController();
    generator.onCall = async (label) => {
      if (label === "detail:2") {
        shutdown.abort();
      }
    };
    const task = makeTask({
      generator,
      github: makeMultiCallGitHub(HEAD_1),
      forceMultiCall: true,
    });

    await expect(
      task(payload, { job: LAST_ATTEMPT, abortSignal: shutdown.signal }),
    ).rejects.toThrow("shutdown on the job's last attempt");

    expect(await readStatus(pr)).toMatchObject({
      status: GenerationStatuses.FAILED,
      errorCode: "attempts-exhausted",
    });
    expect(await listPartKeys(pr)).toEqual(["grouping", "detail:1"]);
  });

  it("starts over when the span holds detail parts but no grouping part", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const parts = createGenerationPartStore(harness.handle, ctx);
    await parts.write({
      ...makeSpan(pr),
      partKey: "detail:1",
      body: { kind: GenerationPartKinds.DETAIL, chunks: [] },
    });
    const generator = stubThreeGroupGenerator();

    await makeTask({
      generator,
      github: makeMultiCallGitHub(HEAD_1),
      forceMultiCall: true,
    })(payload);

    expect(generator.calls.slice(0, 3)).toEqual(MULTI_CALL_LABELS);
    expect(await listAttempts()).toEqual([
      { units: 3, parts_done: 2, parts_total: 2 },
    ]);
    expect(await listPartKeys(pr)).toEqual([]);
  });

  it("deletes a dead writer's parts when it finds the pair's brief stored", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    await makeTask({
      generator: stubThreeGroupGenerator(),
      github,
      forceMultiCall: true,
    })(payload);
    const parts = createGenerationPartStore(harness.handle, ctx);
    await parts.write({
      ...makeSpan(pr),
      partKey: "grouping",
      body: {
        kind: GenerationPartKinds.GROUPING,
        grouping: MULTI_CALL_GROUPING,
        gitAttributesDigest: NO_GIT_ATTRIBUTES_DIGEST,
        anchorPlanDigest: NO_ANCHOR_PLAN_DIGEST,
      },
    });
    const generator = stubThreeGroupGenerator();

    await makeTask({ generator, github, forceMultiCall: true })(payload);

    expect(generator.calls).not.toContain("grouping");
    expect(await listPartKeys(pr)).toEqual([]);
  });

  it("succeeds with a warn when the parts cannot be deleted after the write", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await failPartDeletes();
    const { logger, readLines } = captureLogger();

    await makeTask({
      generator: stubThreeGroupGenerator(),
      github: makeMultiCallGitHub(HEAD_1),
      forceMultiCall: true,
      log: logger,
    })(payload);

    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(await readStoredBrief(pr)).toBeDefined();
    expect(await listPartKeys(pr)).toEqual([
      "grouping",
      "detail:1",
      "detail:2",
    ]);
    const warned = readLines().find((line) =>
      String(line["msg"]).includes("stored parts could not be deleted"),
    );
    expect(warned?.["level"]).toBe("warn");
  });

  it("settles a stored brief with a warn when its parts cannot be deleted", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await failPartDeletes();
    const github = makeMultiCallGitHub(HEAD_1);
    await makeTask({
      generator: stubThreeGroupGenerator(),
      github,
      forceMultiCall: true,
    })(payload);
    const generator = stubThreeGroupGenerator();

    await makeTask({ generator, github, forceMultiCall: true })(payload);

    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(generator.calls).not.toContain("grouping");
    await allowPartDeletes();
    await makeTask({ generator, github, forceMultiCall: true })(payload);
    expect(await listPartKeys(pr)).toEqual([]);
  });

  it("reads .gitattributes from the default branch and shortens its files", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeMultiCallGitHub(HEAD_1);
    github.addRepoFile(
      REPO,
      { path: ".gitattributes" },
      buildRepoFile("src/c.ts linguist-generated\n", "attr-sha"),
    );
    github.addRepoFile(
      REPO,
      { path: ".gitattributes", ref: HEAD_1 },
      buildRepoFile("src/a.ts linguist-generated\n", "head-attr-sha"),
    );
    const generator = stubThreeGroupGenerator();

    await makeTask({ generator, github, forceMultiCall: true })(payload);

    expect(listRepoFilePaths(github)).toContain(".gitattributes");
    expect(generator.calls.slice(0, 2)).toEqual(["grouping", "detail:1"]);
    const brief = JSON.parse((await readStoredBrief(pr))?.body ?? "{}");
    const readAsByFile = new Map<string, string | undefined>(
      brief.chunks.map((chunk: { file: string; readAs?: string }) => [
        chunk.file,
        chunk.readAs,
      ]),
    );
    expect(readAsByFile.get("src/c.ts")).toBe("counts-only");
    expect(readAsByFile.get("src/a.ts")).toBeUndefined();
  });

  it("runs the single-call plan in the large pool when the guess was wrong", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();

    await makeLargePoolTask({ generator, github: makeGitHub(HEAD_1) })(payload);

    expect(generator.calls.slice(0, 1)).toEqual(["brief"]);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("runs the multi-call plan in the large pool", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubThreeGroupGenerator();

    await makeLargePoolTask({
      generator,
      github: makeMultiCallGitHub(HEAD_1),
      forceMultiCall: true,
    })(payload);

    expect(generator.calls.slice(0, 3)).toEqual(MULTI_CALL_LABELS);
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });
});
