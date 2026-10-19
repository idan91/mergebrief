// Loaded only by `startTracing`'s dynamic import, so a process with tracing
// off never evaluates the SDK, the exporter or an instrumentation.
import type { IncomingMessage } from "node:http";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
  type Sampler,
} from "@opentelemetry/sdk-trace";
import { EXPORT_TIMEOUT_MS } from "./consts";
import { createSpanRedactor } from "./span-redaction";
import {
  TraceSamplers,
  type SamplerConfig,
  type StartTracingOptions,
  type TracingConfig,
} from "./types";
import { isUntracedPath } from "./untraced-paths";

function buildSampler({ name, ratio }: SamplerConfig): Sampler {
  const samplers: Record<SamplerConfig["name"], () => Sampler> = {
    [TraceSamplers.ALWAYS_ON]: () => new AlwaysOnSampler(),
    [TraceSamplers.ALWAYS_OFF]: () => new AlwaysOffSampler(),
    [TraceSamplers.TRACE_ID_RATIO]: () => new TraceIdRatioBasedSampler(ratio),
    [TraceSamplers.PARENT_BASED_ALWAYS_ON]: () =>
      new ParentBasedSampler({ root: new AlwaysOnSampler() }),
    [TraceSamplers.PARENT_BASED_ALWAYS_OFF]: () =>
      new ParentBasedSampler({ root: new AlwaysOffSampler() }),
    [TraceSamplers.PARENT_BASED_TRACE_ID_RATIO]: () =>
      new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
  };
  return samplers[name]();
}

// Outgoing calls and queries open an OTel span only inside a trace, so
// graphile's idle polling and the api's timed update check start none.
function registerFirstCutInstrumentations(
  untracedPathPrefixes: readonly string[],
): void {
  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request: IncomingMessage) =>
          isUntracedPath(request.url ?? "", untracedPathPrefixes),
        requireParentforOutgoingSpans: true,
      }),
      new UndiciInstrumentation({ requireParentforSpans: true }),
      new PgInstrumentation({ requireParentSpan: true }),
    ],
  });
}

export function startTracerProvider(
  config: TracingConfig,
  options: Pick<StartTracingOptions, "exporter" | "untracedPathPrefixes">,
): TracerProvider {
  const resource = resourceFromAttributes({
    ...config.resourceAttributes,
    [ATTR_SERVICE_NAME]: config.serviceName,
  });
  const exporter =
    options.exporter ??
    new OTLPTraceExporter({
      url: config.url,
      headers: config.headers,
      timeoutMillis: EXPORT_TIMEOUT_MS,
    });
  const exportProcessor = new BatchSpanProcessor({ exporter });
  const provider = new TracerProvider({
    resource,
    sampler: buildSampler(config.sampler),
    spanProcessors: [createSpanRedactor(), exportProcessor],
  });

  const contextManager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(contextManager);
  // Trace context only: nothing reads baggage, so a client's never travels on.
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
  registerFirstCutInstrumentations(options.untracedPathPrefixes ?? []);
  return provider;
}
