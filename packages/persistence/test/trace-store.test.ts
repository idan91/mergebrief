import { startTestTracing, type TestTracing } from "logging/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ScopeViolationError } from "../src/stores/scope";
import { traceStore } from "../src/stores/trace-store";

let tracing: TestTracing | undefined;

afterEach(async () => {
  await tracing?.stop();
  tracing = undefined;
});

function makeRefusingStore(error: Error) {
  return {
    async write() {
      throw error;
    },
  };
}

async function readWriteFailed(error: Error): Promise<boolean | undefined> {
  tracing = startTestTracing();
  const store = traceStore("briefs", makeRefusingStore(error));
  await tracing.runInSpan(async () => {
    await expect(store.write()).rejects.toBe(error);
  });
  const spans = tracing.readFinishedSpans();
  return spans.find((span) => span.name === "briefs.write")?.failed;
}

describe("traceStore", () => {
  it("leaves a scope violation's span unfailed", async () => {
    const violation = new ScopeViolationError("brief", 7n, "tenant 1");

    expect(await readWriteFailed(violation)).toBe(false);
  });

  it("fails the span on any other throw", async () => {
    const fault = new Error("pool exhausted");

    expect(await readWriteFailed(fault)).toBe(true);
  });
});
