import { startTestTracing, type TestTracing } from "logging/testing";
import { afterEach, describe, expect, it } from "vitest";
import { traceRunStep } from "../src/task/generate/logic/step-span";
import { SupersededSignal } from "../src/task/generate/logic/run-signals";

let tracing: TestTracing | undefined;

afterEach(async () => {
  await tracing?.stop();
  tracing = undefined;
});

async function readFailed(
  stops: readonly (AbortSignal | undefined)[],
  error: Error,
): Promise<boolean | undefined> {
  tracing = startTestTracing();
  const step = traceRunStep("brief.generate", stops, () =>
    Promise.reject(error),
  );
  await expect(step).rejects.toBe(error);
  const [span] = tracing.readFinishedSpans();
  return span?.failed;
}

describe("traceRunStep", () => {
  it("fails the span on a throw the run did not choose", async () => {
    const failed = await readFailed([undefined], new Error("provider down"));

    expect(failed).toBe(true);
  });

  it("leaves the span unfailed when a newer push ended the run", async () => {
    const failed = await readFailed([], new SupersededSignal("head moved"));

    expect(failed).toBe(false);
  });

  it("leaves the span unfailed when the watch aborted the step", async () => {
    const watch = new AbortController();
    watch.abort();

    const failed = await readFailed([watch.signal], new Error("aborted"));

    expect(failed).toBe(false);
  });
});
