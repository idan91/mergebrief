import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  GenerationKinds,
} from "persistence";
import { RepoConfigPaths } from "repo-config";
import {
  BASE,
  buildRepoFile,
  captureLogger,
  ctx,
  CUSTOM_RISK,
  CUSTOM_RISK_POLICY,
  harness,
  HEAD_1,
  HEAD_2,
  makeGitHub,
  makeReviewerId,
  makeTask,
  PR_REF,
  REPO,
  setUpHarness,
  stubGenerator,
  trigger,
  type StubGenerator,
} from "./helpers";

const UNEXPECTED_SHAPE_WARNING =
  "generate: stored brief body has an unexpected shape — narrative skipped";
const BODY_MARKER = "body-marker-9f3c";

/** The stub brief with `token` fired on every chunk. */
function makeBriefOutputFiring(token: string, summary: string): unknown {
  const base = stubGenerator().outputs["brief"] as { chunks: object[] };
  const chunks = base.chunks.map((chunk) => ({
    ...chunk,
    riskSurface: [token],
  }));
  return { ...base, summary, chunks };
}

/** The stub brief with its one group renamed to `groupId`. */
function makeBriefOutputGrouped(groupId: string): unknown {
  const base = stubGenerator().outputs["brief"] as {
    changeGroups: object[];
    chunks: object[];
  };
  const changeGroups = base.changeGroups.map((group) => ({
    ...group,
    id: groupId,
  }));
  const chunks = base.chunks.map((chunk) => ({
    ...chunk,
    changeGroupId: groupId,
  }));
  return { ...base, changeGroups, chunks };
}

/** Hands `output` to the pipeline for `label` without the schema parse. */
function stubUnparsedOutput(
  generator: StubGenerator,
  label: string,
  output: unknown,
): void {
  const parseOutput = generator.generate.bind(generator);
  generator.generate = (request) => {
    if (request.label !== label) {
      return parseOutput(request);
    }
    generator.calls.push(label);
    return Promise.resolve(output as never);
  };
}

setUpHarness();

describe("generate task, stored artifact bodies", () => {
  /** Rev 1, an optional SQL rewrite of its stored body, then a second push. */
  async function runSecondPush(options: {
    policy?: string;
    rev1Output?: unknown;
    rev2Output?: unknown;
    storedBodySql?: string;
    /** Rev 1's row predates the used-group-ids column. */
    clearUsedGroupIds?: boolean;
  }) {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    if (options.rev1Output !== undefined) {
      generator.outputs["brief"] = options.rev1Output;
    }
    const github = makeGitHub(HEAD_1);
    if (options.policy !== undefined) {
      github.addRepoFile(
        REPO,
        { path: RepoConfigPaths.POLICY },
        buildRepoFile(options.policy, "sha-p"),
      );
    }
    const { logger, readLines } = captureLogger({ LOG_LEVEL: "debug" });
    const task = makeTask({ generator, github, log: logger });
    await task(first.payload);
    if (options.storedBodySql !== undefined) {
      await harness.raw(
        `update brief set body = ${options.storedBodySql} where head_sha = '${HEAD_1}'`,
      );
    }
    if (options.clearUsedGroupIds === true) {
      await harness.raw(
        `update brief set used_group_ids = null where head_sha = '${HEAD_1}'`,
      );
    }
    if (options.rev2Output !== undefined) {
      generator.outputs["brief"] = options.rev2Output;
    }

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(second.pr.id, BASE, HEAD_2);
    const shapeWarnings = readLines().filter(
      (line) => line["msg"] === UNEXPECTED_SHAPE_WARNING,
    );
    return { row, readLines, shapeWarnings };
  }

  it("anchors on a stored brief that fires a custom risk attribute", async () => {
    const { row, readLines, shapeWarnings } = await runSecondPush({
      policy: CUSTOM_RISK_POLICY,
      rev1Output: makeBriefOutputFiring(CUSTOM_RISK, "stub brief"),
    });

    expect(row?.anchorState).toBe("anchored");
    expect(shapeWarnings).toEqual([]);
    expect(
      readLines().some((line) => line["evt"] === "artifact.check.fail"),
    ).toBe(false);
  });

  it("restarts unanchored and warns on an empty stored body", async () => {
    const { row, readLines, shapeWarnings } = await runSecondPush({
      storedBodySql: "'{}'",
    });

    expect(row?.anchorState).toBe("none");
    expect(shapeWarnings.map((line) => line["level"])).toEqual(["warn"]);
    const issues = readLines().filter(
      (line) => line["msg"] === "generate: stored brief body issue",
    );
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue).toMatchObject({ level: "debug", code: "invalid" });
      expect(issue).toHaveProperty("path");
      expect(issue).not.toHaveProperty("message");
    }
  });

  it("restarts unanchored and warns on a body with no generation", async () => {
    const { row, shapeWarnings } = await runSecondPush({
      storedBodySql: "(body::jsonb - 'generation')::text",
    });

    expect(row?.anchorState).toBe("none");
    expect(shapeWarnings.map((line) => line["level"])).toEqual(["warn"]);
  });

  it("keeps the chain's group ids when the stored body cannot anchor", async () => {
    const { row, shapeWarnings } = await runSecondPush({
      storedBodySql:
        "jsonb_set(body::jsonb, '{commitRange}', (body::jsonb -> 'commitRange') - 'commitCount')::text",
      clearUsedGroupIds: true,
      rev2Output: makeBriefOutputGrouped("g2"),
    });

    expect(row?.anchorState).toBe("none");
    expect(shapeWarnings.map((line) => line["level"])).toEqual(["warn"]);
    expect(JSON.parse(row?.usedGroupIds ?? "null")).toEqual(["g1", "g2"]);
  });

  it("writes the delta and warns once when its write check fails", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    const { logger, readLines } = captureLogger();
    const task = makeTask({ generator, github, log: logger });
    await task(first.payload);
    const repo = createTenantRepository(harness.handle, ctx);
    const checkpoint = await repo.checkpoints.upsertOnSubmit({
      pullRequestId: first.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: HEAD_1,
      submittedAt: new Date(),
    });
    expect(checkpoint.ok).toBe(true);
    const delta = generator.outputs["delta"] as object;
    stubUnparsedOutput(generator, "delta", {
      ...delta,
      summary: BODY_MARKER,
      wholePrImpact: 7,
    });

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.deltas.get(second.pr.id, HEAD_1, HEAD_2);
    expect(row?.body).toContain(BODY_MARKER);
    expect(JSON.parse(row?.body ?? "{}")).toMatchObject({ wholePrImpact: 7 });
    const failures = readLines().filter(
      (line) => line["evt"] === "artifact.check.fail",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      level: "warn",
      kind: GenerationKinds.DELTA,
      issueCount: 1,
      firstPath: "wholePrImpact",
    });
    expect(JSON.stringify(failures)).not.toContain(BODY_MARKER);
  });

  it("writes the narrative and warns once when its write check fails", async () => {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    const { logger, readLines } = captureLogger();
    const task = makeTask({ generator, github, log: logger });
    await task(first.payload);
    stubUnparsedOutput(generator, "revision narrative", {
      overview: BODY_MARKER,
      chunks: [],
      inventedKey: true,
    });

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.revisionNarratives.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    expect(row?.body).toContain(BODY_MARKER);
    expect(JSON.parse(row?.body ?? "{}")).toMatchObject({ inventedKey: true });
    const failures = readLines().filter(
      (line) => line["evt"] === "artifact.check.fail",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      level: "warn",
      kind: GenerationKinds.REVISION_NARRATIVE,
      issueCount: 1,
    });
    expect(JSON.stringify(failures)).not.toContain(BODY_MARKER);
    expect(JSON.stringify(failures)).not.toContain("inventedKey");
  });

  it("writes the brief and warns once when the write check fails", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const output = makeBriefOutputFiring("undeclared-risk", BODY_MARKER);
    generator.generate = () => Promise.resolve(output as never);
    const { logger, readLines } = captureLogger();
    const task = makeTask({ generator, log: logger });

    await task(payload);

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_1);
    expect(row?.body).toContain(BODY_MARKER);
    expect(row?.body).toContain("undeclared-risk");
    const failures = readLines().filter(
      (line) => line["evt"] === "artifact.check.fail",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      level: "warn",
      kind: "brief",
      issueCount: 1,
      firstPath: "chunks.0.riskSurface.0",
    });
    expect(failures[0]).not.toHaveProperty("message");
    expect(JSON.stringify(failures)).not.toContain(BODY_MARKER);
    expect(JSON.stringify(failures)).not.toContain("undeclared-risk");
  });
});
