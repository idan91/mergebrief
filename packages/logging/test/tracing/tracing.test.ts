import { context, diag, propagation, trace } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTracing, stopTracing } from "../../src/tracing";

const ON_ENV = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1" };
/** Ample for the in-memory exporter; cleanup must never wait the default. */
const CLEANUP_STOP_BUDGET_MS = 50;
const HUNG_COLLECTOR_BUDGET_MS = 20;

interface RecordingExporter extends SpanExporter {
  spans: ReadableSpan[];
}

function makeRecordingExporter(shutdown = async () => {}): RecordingExporter {
  const spans: ReadableSpan[] = [];
  return {
    spans,
    export(batch: ReadableSpan[], done: (result: ExportResult) => void): void {
      spans.push(...batch);
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown,
  };
}

function stubLog() {
  return { warn: vi.fn() };
}

afterEach(async () => {
  await stopTracing(stubLog(), CLEANUP_STOP_BUDGET_MS);
  trace.disable();
  context.disable();
  propagation.disable();
  diag.disable();
});

describe("startTracing", () => {
  it("stays off without an endpoint and stops as a no-op", async () => {
    const log = stubLog();
    expect(await startTracing({ env: {}, serviceName: "svc", log })).toEqual({
      ok: true,
      value: "off",
    });
    expect(await stopTracing(log)).toBe("off");
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("returns the refusal for an invalid variable", async () => {
    const env = { ...ON_ENV, OTEL_TRACES_SAMPLER: "sometimes" };
    const started = await startTracing({
      env,
      serviceName: "svc",
      log: stubLog(),
    });
    expect(started.ok).toBe(false);
  });

  it("exports spans under the service name and flushes on stop", async () => {
    const exporter = makeRecordingExporter();
    const log = stubLog();
    const started = await startTracing({
      env: ON_ENV,
      serviceName: "svc",
      log,
      exporter,
    });
    expect(started).toEqual({ ok: true, value: "on" });

    trace.getTracer("test").startActiveSpan("job", (span) => span.end());
    expect(await stopTracing(log)).toBe("flushed");

    expect(exporter.spans.map((span) => span.name)).toEqual(["job"]);
    expect(exporter.spans[0]?.resource.attributes["service.name"]).toBe("svc");
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("starts once even when called twice", async () => {
    const exporter = makeRecordingExporter();
    const options = {
      env: ON_ENV,
      serviceName: "svc",
      log: stubLog(),
      exporter,
    };
    await startTracing(options);
    expect(await startTracing(options)).toEqual({ ok: true, value: "on" });
  });
});

describe("stopTracing", () => {
  it("gives up on a collector that never answers within the budget", async () => {
    const exporter = makeRecordingExporter(() => new Promise<void>(() => {}));
    const log = stubLog();
    await startTracing({ env: ON_ENV, serviceName: "svc", log, exporter });

    const outcome = await stopTracing(log, HUNG_COLLECTOR_BUDGET_MS);
    expect(outcome).toBe("timed-out");
    expect(log.warn).toHaveBeenCalledWith(
      "tracing: the last spans were not exported",
      {
        outcome: "timed-out",
      },
    );
  });

  it("reports a failed shutdown", async () => {
    const exporter = makeRecordingExporter(() =>
      Promise.reject(new Error("boom")),
    );
    const log = stubLog();
    await startTracing({ env: ON_ENV, serviceName: "svc", log, exporter });
    expect(await stopTracing(log)).toBe("failed");
  });
});

describe("tracing diagnostics", () => {
  it("routes the SDK's own errors to the logger as warn", async () => {
    const log = stubLog();
    await startTracing({
      env: ON_ENV,
      serviceName: "svc",
      log,
      exporter: makeRecordingExporter(),
    });
    const failure = new Error("export failed");
    diag.error("exporter", failure);
    diag.info("chatter");

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("tracing: exporter", {
      err: failure,
    });
  });
});
