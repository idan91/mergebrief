import type { JobHelpers } from "graphile-worker";
import { startTestTracing, type TestTracing } from "logging/testing";
import { afterEach, describe, expect, it } from "vitest";
import { traceJob } from "../src/task/job-span";

let tracing: TestTracing | undefined;

afterEach(async () => {
  await tracing?.stop();
  tracing = undefined;
});

function stubHelpers(): JobHelpers {
  return { job: { id: "91", attempts: 2 } } as JobHelpers;
}

describe("traceJob", () => {
  it("runs the task inside a span named for it, linked to the enqueue", async () => {
    tracing = startTestTracing();
    const traceparent =
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const seen: unknown[] = [];
    const task = traceJob("generate", (payload) => {
      seen.push(payload);
    });

    await task({ traceparent }, stubHelpers());

    const [job] = tracing.readFinishedSpans();
    expect(seen).toEqual([{ traceparent }]);
    expect(job?.name).toBe("process generate");
    expect(job?.links).toEqual([
      {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
      },
    ]);
    expect(job?.attributes).toMatchObject({
      "messaging.system": "graphile_worker",
      "messaging.destination.name": "generate",
      "messaging.message.id": "91",
      "messaging.graphile_worker.attempts": 2,
    });
  });

  it("passes a task failure through to graphile", async () => {
    tracing = startTestTracing();
    const task = traceJob("generate", () => {
      throw new Error("transient");
    });
    const run = task({}, stubHelpers());
    await expect(run).rejects.toThrow("transient");
    expect(tracing.readFinishedSpans()[0]?.failed).toBe(true);
  });
});
