import { context, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import { startTestTracing, type TestTracing } from "../src/testing";
import { readActiveTraceparent, runInJobSpan } from "../src/trace-context";

const ATTRIBUTES = { "messaging.destination.name": "generate" };

let tracing: TestTracing | undefined;

afterEach(async () => {
  await tracing?.stop();
  tracing = undefined;
});

describe("readActiveTraceparent", () => {
  it("is absent with tracing off", () => {
    expect(readActiveTraceparent()).toBeUndefined();
  });

  it("writes the active span as a sampled W3C traceparent", async () => {
    tracing = startTestTracing();
    let traceparent: string | undefined;
    const ids = await tracing.runInSpan(async () => {
      traceparent = readActiveTraceparent();
    });
    expect(traceparent).toBe(`00-${ids.traceId}-${ids.spanId}-01`);
  });
});

describe("readActiveTraceparent in a dropped trace", () => {
  it("is absent when the active trace was not sampled", () => {
    tracing = startTestTracing();
    const dropped = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: TraceFlags.NONE,
      isRemote: true,
    });
    expect(
      context.with(dropped, () => readActiveTraceparent()),
    ).toBeUndefined();
  });
});

describe("runInJobSpan", () => {
  it("runs the job with tracing off and returns its outcome", async () => {
    const outcome = await runInJobSpan(
      { name: "process generate", attributes: ATTRIBUTES },
      async () => "done",
    );
    expect(outcome).toBe("done");
  });

  it("opens a root span linked to the enqueue's traceparent", async () => {
    tracing = startTestTracing();
    let traceparent: string | undefined;
    const enqueue = await tracing.runInSpan(async () => {
      traceparent = readActiveTraceparent();
    });
    await tracing.runInSpan(() =>
      runInJobSpan(
        { name: "process generate", traceparent, attributes: ATTRIBUTES },
        async () => {},
      ),
    );

    const job = tracing
      .readFinishedSpans()
      .find((span) => span.name === "process generate");
    expect(job?.parentSpanId).toBeUndefined();
    expect(job?.traceId).not.toBe(enqueue.traceId);
    expect(job?.links).toEqual([enqueue]);
    expect(job?.attributes).toEqual(ATTRIBUTES);
  });

  it("starts unlinked without a traceparent or with a malformed one", async () => {
    tracing = startTestTracing();
    await runInJobSpan(
      { name: "process sweep", attributes: {} },
      async () => {},
    );
    await runInJobSpan(
      { name: "process generate", traceparent: "00-nope", attributes: {} },
      async () => {},
    );
    const links = tracing.readFinishedSpans().map((span) => span.links);
    expect(links).toEqual([[], []]);
  });

  it("marks the span failed and rethrows the job's error", async () => {
    tracing = startTestTracing();
    const failure = new Error("provider down");
    await expect(
      runInJobSpan({ name: "process generate", attributes: {} }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    const [job] = tracing.readFinishedSpans();
    expect(job?.failed).toBe(true);
    expect(JSON.stringify(job)).not.toContain("provider down");
  });
});
