// ENTRY of `logging/testing`: an in-memory tracer for tests in packages that
// do not depend on OTel themselves. Test code only.
import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type AttributeValue,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace";

export interface SpanIds {
  traceId: string;
  spanId: string;
}

export interface RecordedSpan extends SpanIds {
  name: string;
  parentSpanId?: string;
  links: SpanIds[];
  attributes: Record<string, AttributeValue | undefined>;
  failed: boolean;
}

export interface TestTracing {
  /** Runs `run` inside a fresh active span; resolves to that span's ids. */
  runInSpan(run: () => Promise<void>): Promise<SpanIds>;
  readFinishedSpans(): RecordedSpan[];
  /** Restores the no-op globals. */
  stop(): Promise<void>;
}

function recordSpan(span: ReadableSpan): RecordedSpan {
  const { traceId, spanId } = span.spanContext();
  const recorded: RecordedSpan = {
    name: span.name,
    traceId,
    spanId,
    links: span.links.map((link) => ({
      traceId: link.context.traceId,
      spanId: link.context.spanId,
    })),
    attributes: { ...span.attributes },
    failed: span.status.code === SpanStatusCode.ERROR,
  };
  const parentSpanId = span.parentSpanContext?.spanId;
  if (parentSpanId !== undefined) {
    recorded.parentSpanId = parentSpanId;
  }
  return recorded;
}

export function startTestTracing(): TestTracing {
  const exporter = new InMemorySpanExporter();
  const recorder = new SimpleSpanProcessor({ exporter });
  const provider = new TracerProvider({ spanProcessors: [recorder] });
  const contextManager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);

  return {
    runInSpan: (run) =>
      trace.getTracer("test").startActiveSpan("test", async (span) => {
        try {
          await run();
          const { traceId, spanId } = span.spanContext();
          return { traceId, spanId };
        } finally {
          span.end();
        }
      }),
    readFinishedSpans: () => exporter.getFinishedSpans().map(recordSpan),
    stop: async () => {
      await provider.shutdown();
      trace.disable();
      propagation.disable();
      context.disable();
    },
  };
}
