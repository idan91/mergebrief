import { startTestTracing, type TestTracing } from "logging/testing";
import { describe, expect, it } from "vitest";
import {
  GeneratorError,
  GeneratorErrorKinds,
  type Effort,
  type Generator,
} from "generators";
import { FakeFailures } from "github/testing";
import {
  createGenerationProjection,
  InvalidArtifactBodyError,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import {
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  makeGitHub,
  makeTarget,
  makeTask,
  setUpHarness,
  stubGenerator,
  trigger,
} from "./helpers";

const OTHER_INSTALLATION = 4242;

setUpHarness();

describe("generate task, observability", () => {
  it("logs transient job.fail with attempts and job bindings", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
    const { logger, readLines } = captureLogger();
    const task = makeTask({ github, log: logger });

    await expect(
      task(payload, {
        job: { attempts: 1, max_attempts: 25, run_at: new Date() },
      }),
    ).rejects.toThrow("502");

    const fail = readLines().find((line) => line["evt"] === "job.fail");
    expect(fail?.["level"]).toBe("error");
    expect(fail?.["permanent"]).toBe(false);
    expect(fail?.["attempt"]).toBe(1);
    expect(fail?.["maxAttempts"]).toBe(25);
    expect(fail?.["prId"]).toBe(String(pr.id));
    expect(fail?.["headSha"]).toBe(HEAD_1);
    expect(
      readLines().some((line) => line["evt"] === "job.retries.exhausted"),
    ).toBe(false);
  });

  it("logs generation.complete with the model call duration", async () => {
    const { payload } = await trigger(HEAD_1);
    const { logger, readLines } = captureLogger();
    const task = makeTask({ log: logger });

    await task(payload);

    const done = readLines().find(
      (line) => line["evt"] === "generation.complete",
    );
    expect(done?.["level"]).toBe("info");
    expect(done?.["kind"]).toBe("brief");
    expect(done?.["outcome"]).toBe("succeeded");
    expect(typeof done?.["durationMs"]).toBe("number");
  });

  it("traces a fresh run's steps and its model call", async () => {
    const { payload } = await trigger(HEAD_1);
    const tracing = startTestTracing();
    const task = makeTask({});

    let spans: ReturnType<TestTracing["readFinishedSpans"]> = [];
    try {
      await task(payload);
      spans = tracing.readFinishedSpans();
    } finally {
      await tracing.stop();
    }
    const names = spans.map((span) => span.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "generation.open",
        "generation.claim",
        "generation.decide",
        "generation.inputs",
        "brief.generate",
        "entry.ready",
        "generation.finish",
        "chat stub-model",
      ]),
    );
    const decide = spans.find((span) => span.name === "generation.decide");
    expect(decide?.attributes["mergebrief.decision"]).toBe("fresh");
    const model = spans.find((span) => span.name === "chat stub-model");
    expect(model?.attributes["mergebrief.generation.kind"]).toBe("brief");
  });

  it("logs generation.succeeded with the pair and the stored brief id", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const { logger, readLines } = captureLogger();
    const task = makeTask({ log: logger });

    await task(payload);

    const [brief] = await harness.raw("select id from brief");
    const done = readLines().find(
      (line) => line["evt"] === "generation.succeeded",
    );
    expect(done).toMatchObject({
      level: "info",
      prId: String(pr.id),
      headSha: HEAD_1,
      briefId: String(brief?.["id"]),
    });
  });

  it("logs generation.complete when the model call throws", async () => {
    const { payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.generate = () => {
      throw new Error("provider exploded");
    };
    const { logger, readLines } = captureLogger();
    const task = makeTask({ generator, log: logger });

    // A permanent provider failure is recorded, not rethrown.
    await task(payload);

    const done = readLines().find(
      (line) => line["evt"] === "generation.complete",
    );
    expect(done?.["outcome"]).toBe("failed");
    expect(typeof done?.["durationMs"]).toBe("number");
  });

  it("fails a job permanently when its write lands outside its scope", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const generate = generator.generate.bind(generator);
    // The row changes installation mid-run, so the brief write names a parent
    // the job's scope no longer holds.
    generator.generate = async (req) => {
      await harness.raw(
        "update pull_request set installation_id = $1::bigint where id = $2::bigint",
        [String(OTHER_INSTALLATION), String(pr.id)],
      );
      return generate(req);
    };
    const { logger, readLines } = captureLogger();
    const task = makeTask({ generator, log: logger });

    const run = task(payload, {
      job: { attempts: 1, max_attempts: 25, run_at: new Date() },
    });
    await expect(run).resolves.toBeUndefined();

    const fail = readLines().find((line) => line["evt"] === "job.fail");
    expect(fail?.["permanent"]).toBe(true);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorParams).toEqual({
      detail: `pull_request ${pr.id} is not in tenant 42`,
    });
  });

  it("fails a job permanently when an artifact body is invalid", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.generate = () => {
      throw new InvalidArtifactBodyError("spans: unrecognized key");
    };
    const { logger, readLines } = captureLogger();
    const task = makeTask({ generator, log: logger });

    const run = task(payload, {
      job: { attempts: 1, max_attempts: 25, run_at: new Date() },
    });
    await expect(run).resolves.toBeUndefined();

    const fail = readLines().find((line) => line["evt"] === "job.fail");
    expect(fail?.["permanent"]).toBe(true);
    const done = readLines().find(
      (line) => line["evt"] === "generation.complete",
    );
    expect(done).toBeUndefined();
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorParams).toEqual({ detail: "spans: unrecognized key" });
  });

  it("mints job.retries.exhausted on the final attempt", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.failOn("fetchPullRequest", FakeFailures.SERVER_ERROR);
    const { logger, readLines } = captureLogger();
    const task = makeTask({ github, log: logger });

    await expect(
      task(payload, {
        job: { attempts: 25, max_attempts: 25, run_at: new Date() },
      }),
    ).rejects.toThrow("502");

    const exhausted = readLines().find(
      (line) => line["evt"] === "job.retries.exhausted",
    );
    expect(exhausted?.["level"]).toBe("error");
    expect(exhausted?.["attempt"]).toBe(25);
    expect(exhausted?.["maxAttempts"]).toBe(25);
    expect(exhausted?.["prId"]).toBe(String(pr.id));
    expect(exhausted?.["headSha"]).toBe(HEAD_1);
  });

  it("a provider-call failure emits provider.error with provider and status", async () => {
    const { payload } = await trigger(HEAD_1);
    const throwing: Generator = {
      async generate(): Promise<never> {
        throw Object.assign(new Error("rate limited"), { status: 429 });
      },
      origin: (effort: Effort) => ({
        provider: "stub",
        model: "stub-model",
        effort,
      }),
    };
    const { logger, readLines } = captureLogger();
    const task = makeTask({ generator: throwing, log: logger });

    await expect(
      task(payload, {
        job: { attempts: 1, max_attempts: 25, run_at: new Date() },
      }),
    ).rejects.toThrow("rate limited");

    const provider = readLines().find(
      (line) => line["evt"] === "provider.error",
    );
    expect(provider?.["level"]).toBe("error");
    expect(provider?.["provider"]).toBe("stub");
    expect(provider?.["status"]).toBe(429);
    expect(provider?.["headSha"]).toBe(HEAD_1);
    expect(readLines().some((line) => line["evt"] === "job.fail")).toBe(true);
  });

  it("a GeneratorError emits provider.error with its kind", async () => {
    const { payload } = await trigger(HEAD_1);
    const throwing: Generator = {
      async generate(): Promise<never> {
        throw new GeneratorError(
          GeneratorErrorKinds.AUTH,
          "provider rejected the key",
        );
      },
      origin: (effort: Effort) => ({
        provider: "stub",
        model: "stub-model",
        effort,
      }),
    };
    const { logger, readLines } = captureLogger();
    const task = makeTask({ generator: throwing, log: logger });

    await expect(task(payload)).resolves.toBeUndefined();

    const provider = readLines().find(
      (line) => line["evt"] === "provider.error",
    );
    expect(provider?.["provider"]).toBe("stub");
    expect(provider?.["kind"]).toBe("auth");
    const fail = readLines().find((line) => line["evt"] === "job.fail");
    expect(fail?.["permanent"]).toBe(true);
  });

  it("logs generation.start once with the queue wait", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const { logger, readLines } = captureLogger();
    const task = makeTask({ log: logger });

    await task(payload, {
      job: { attempts: 0, max_attempts: 25, run_at: new Date() },
    });

    const starts = readLines().filter(
      (line) => line["evt"] === "generation.start",
    );
    expect(starts.length).toBe(1);
    const start = starts[0];
    expect(start?.["level"]).toBe("info");
    expect(typeof start?.["waitMs"]).toBe("number");
    expect(start?.["waitMs"]).toBeGreaterThanOrEqual(0);
    expect(start?.["attempt"]).toBe(0);
    expect(start?.["prId"]).toBe(String(pr.id));
    expect(start?.["headSha"]).toBe(HEAD_1);
  });

  it("waitMs counts from the job's run_at, not the row's created_at", async () => {
    const { payload } = await trigger(HEAD_1);
    const { logger, readLines } = captureLogger();
    const task = makeTask({ log: logger });
    const runAt = new Date(Date.now() - 5_000);

    await task(payload, {
      job: { attempts: 0, max_attempts: 25, run_at: runAt },
    });

    const start = readLines().find(
      (line) => line["evt"] === "generation.start",
    );
    expect(start?.["waitMs"]).toBeGreaterThanOrEqual(5_000);
    expect(start?.["waitMs"]).toBeLessThan(60_000);
  });
});
