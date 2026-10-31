// A multi-call run in the worker: units claimed after grouping, parts stored
// as they land and resumed from, deleted once the brief is stored, kept on
// any failure but a permanent one over every part; the default branch's
// .gitattributes decides shortened files and whether a grouping is reusable.
import {
  createArtifactStore,
  createGenerationPartStore,
  createGenerationProjection,
  GenerationPartKinds,
  type PullRequestRow,
} from "persistence";
import {
  GeneratorError,
  GeneratorErrorKinds,
  type Generator,
} from "generators";
import { FakeFailures } from "github/testing";
import { claimTestRun } from "persistence/testing";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  createMultiCallRun,
  digestGitAttributes,
} from "../../src/task/generate/logic/generation-parts";
import {
  GitAttributesReadings,
  type RunContext,
} from "../../src/task/generate/types";
import {
  BASE,
  buildRepoFile,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  LAST_ATTEMPT,
  listRepoFilePaths,
  makeConnectionError,
  makeGitHub,
  makeInOrderGrouping,
  makeLargePoolTask,
  makeMultiCallGitHub,
  makeTarget,
  makeTask,
  MULTI_CALL_GROUPING,
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
  } as unknown as RunContext;
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
}

async function listAttempts(): Promise<AttemptRow[]> {
  const rows = await harness.raw(
    "select units, parts_done from generation_attempt order by id",
  );
  return rows.map((row) => ({
    units: Number(row["units"]),
    parts_done: Number(row["parts_done"]),
  }));
}

function makeSpan(pr: PullRequestRow) {
  return { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD_1 };
}

async function listPartKeys(pr: PullRequestRow): Promise<string[]> {
  const parts = createGenerationPartStore(harness.handle, ctx);
  const rows = await parts.listForSpan(makeSpan(pr));
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

/** A grouping part stored under `gitAttributesDigest` and one detail part, as a cut run leaves them. */
async function storeResumableParts(
  pr: PullRequestRow,
  gitAttributesDigest = NO_GIT_ATTRIBUTES_DIGEST,
): Promise<void> {
  const parts = createGenerationPartStore(harness.handle, ctx);
  await parts.write({
    ...makeSpan(pr),
    partKey: "grouping",
    body: {
      kind: GenerationPartKinds.GROUPING,
      grouping: MULTI_CALL_GROUPING,
      gitAttributesDigest,
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
    expect(await listAttempts()).toEqual([{ units: 3, parts_done: 2 }]);
    expect(await listPartKeys(pr)).toEqual([]);
    const brief = await readStoredBrief(pr);
    expect(brief).toBeDefined();
    expect(JSON.parse(brief?.body ?? "{}")).toMatchObject({
      outlineForm: "full",
      changeGroups: [{ id: "g1" }, { id: "g2" }, { id: "g3" }],
    });
    expect((await readStatus(pr))?.status).toBe(GenerationStatuses.SUCCEEDED);
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
    expect(await listAttempts()).toEqual([{ units: 1, parts_done: 0 }]);
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
    expect(await listAttempts()).toEqual([{ units: 3, parts_done: 0 }]);
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
      { units: 3, parts_done: 0 },
      { units: 3, parts_done: 2 },
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

  it("stamps a multi-call brief over an anchored previous row as none", async () => {
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
    expect(row?.anchorState).toBe("none");
    expect(row?.anchorReason).toBeNull();
    expect(row?.carriedChunkIds).toEqual([]);
    expect(JSON.parse(row?.body ?? "{}")).toMatchObject({
      anchor: { state: "none" },
    });
    expect(row?.usedGroupIds).toContain("g1");
    expect(new Set(row?.usedGroupIds).size).toBe(4);
  });

  it("starts over when a stored part is off the shape the store accepts", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await harness.raw(
      `insert into generation_part (installation_id, pull_request_id, base_sha, head_sha, part_key, body, byte_size) values (42, ${pr.id}, '${BASE}', '${HEAD_1}', 'grouping', '{"kind":"grouping"}', 18)`,
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
    expect(await listAttempts()).toEqual([{ units: 1, parts_done: 0 }]);
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
      { units: 1, parts_done: 0 },
      { units: 3, parts_done: 2 },
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
      expect(await listAttempts()).toEqual([{ units: 3, parts_done: 2 }]);
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
    expect(await listAttempts()).toEqual([{ units: 3, parts_done: 2 }]);
    expect(await listPartKeys(pr)).toEqual([]);
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
    expect(await listAttempts()).toEqual([{ units: 3, parts_done: 1 }]);

    const resumed = stubThreeGroupGenerator();
    await makeTask({ generator: resumed, github, forceMultiCall: true })(
      payload,
      { job: SECOND_ATTEMPT },
    );

    expect(resumed.calls.slice(0, 1)).toEqual(["detail:2"]);
    expect(await listAttempts()).toEqual([
      { units: 3, parts_done: 1 },
      { units: 2, parts_done: 1 },
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
      { units: 4, parts_done: 2 },
      { units: 2, parts_done: 1 },
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
      { units: 3, parts_done: 1 },
      { units: 3, parts_done: 1 },
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
      { units: 3, parts_done: 1 },
      { units: 2, parts_done: 1 },
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
    expect(await listAttempts()).toEqual([{ units: 3, parts_done: 2 }]);
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
