// Trace context that crosses the queue: the enqueue writes the active
// `traceparent` into the job payload, and the worker opens the job's OTel span
// as a new trace linked to it. A later push can replace a queued job, so one
// job may serve several pushes: a link, never a parent. Reads only the no-op
// `@opentelemetry/api`, so with tracing off both sides are inert.
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Attributes,
  type Link,
} from "@opentelemetry/api";

const TRACER_NAME = "mergebrief";
const TRACEPARENT = "traceparent";

/** The active trace's W3C `traceparent`, absent outside a sampled trace. */
export function readActiveTraceparent(): string | undefined {
  const active = trace.getSpanContext(context.active());
  // A dropped trace still has ids, and a link to it points at nothing.
  const sampled =
    active !== undefined && (active.traceFlags & TraceFlags.SAMPLED) !== 0;
  if (!sampled) {
    return undefined;
  }
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier[TRACEPARENT];
}

function buildEnqueueLinks(traceparent: string | undefined): Link[] {
  if (traceparent === undefined) {
    return [];
  }
  const enqueued = propagation.extract(ROOT_CONTEXT, {
    [TRACEPARENT]: traceparent,
  });
  const spanContext = trace.getSpanContext(enqueued);
  if (spanContext === undefined) {
    return [];
  }
  return [{ context: spanContext }];
}

export interface JobSpanOptions {
  name: string;
  /** The enqueue's `traceparent` from the payload, when it carried one. */
  traceparent?: string | undefined;
  attributes: Attributes;
}

/**
 * Runs one job inside its own root OTel span, linked to the enqueue. A throw
 * marks the span failed and rethrows, so graphile still sees it.
 */
export async function runInJobSpan<Outcome>(
  options: JobSpanOptions,
  run: () => Promise<Outcome>,
): Promise<Outcome> {
  const tracer = trace.getTracer(TRACER_NAME);
  const links = buildEnqueueLinks(options.traceparent);
  return tracer.startActiveSpan(
    options.name,
    {
      root: true,
      kind: SpanKind.CONSUMER,
      links,
      attributes: options.attributes,
    },
    async (span) => {
      try {
        return await run();
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
