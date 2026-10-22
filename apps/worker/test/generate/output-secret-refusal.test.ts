import { createArtifactStore, createGenerationProjection } from "persistence";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { describe, expect, it } from "vitest";
import {
  collectOutputSecrets,
  guardGeneratorOutput,
} from "../../src/task/generate/logic/output-secret";
import {
  BASE,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  makeGitHub,
  PR_REF,
  makeTarget,
  makeTask,
  setUpHarness,
  stubGenerator,
  trigger,
} from "./helpers";

const DB_PASSWORD = "s3cr3t-db-password-value";

setUpHarness();

describe("generate task, secret in the output", () => {
  it("fails the generation as output-secret and stores no brief", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const stub = stubGenerator();
    stub.outputs["brief"] = {
      ...(stub.outputs["brief"] as Record<string, unknown>),
      summary: `the database password is ${DB_PASSWORD}`,
    };
    const secrets = collectOutputSecrets({
      DATABASE_URL: `postgres://mergebrief:${DB_PASSWORD}@db:5432/app`,
    });
    const { logger, readLines } = captureLogger();
    const task = makeTask({
      generator: guardGeneratorOutput(stub, secrets),
      log: logger,
    });

    await expect(task(payload)).resolves.toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.OUTPUT_SECRET);
    expect(await harness.raw("select * from brief")).toHaveLength(0);

    const fail = readLines().find((line) => line["evt"] === "job.fail");
    expect(fail?.["level"]).toBe("error");
    expect(fail?.["permanent"]).toBe(true);
    expect(JSON.stringify(readLines())).toContain("DATABASE_URL");
    expect(JSON.stringify(readLines())).not.toContain(DB_PASSWORD);
  });

  it("drops a narrative carrying a secret and keeps the Brief", async () => {
    const first = await trigger(HEAD_1);
    const stub = stubGenerator();
    stub.outputs["revision narrative"] = {
      overview: `the database password is ${DB_PASSWORD}`,
      chunks: [],
    };
    const secrets = collectOutputSecrets({
      DATABASE_URL: `postgres://mergebrief:${DB_PASSWORD}@db:5432/app`,
    });
    const github = makeGitHub(HEAD_1);
    const { logger, readLines } = captureLogger();
    const task = makeTask({
      generator: guardGeneratorOutput(stub, secrets),
      github,
      log: logger,
    });
    await task(first.payload);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);

    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    expect(await store.briefs.get(second.pr.id, BASE, HEAD_2)).toBeDefined();
    expect(
      await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeUndefined();
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(second.pr, HEAD_2),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    const leakLine = readLines().find(
      (line) =>
        line["level"] === "error" &&
        String(line["msg"]).includes("DATABASE_URL"),
    );
    expect(leakLine).toBeDefined();
    expect(JSON.stringify(readLines())).not.toContain(DB_PASSWORD);
  });
});
