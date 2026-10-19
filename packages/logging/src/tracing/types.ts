import type { SpanExporter } from "@opentelemetry/sdk-trace";
import type { ValueOf } from "types/utils";
import type { Logger } from "../logger";

// Spec-named `OTEL_TRACES_SAMPLER` values; the source's casing is the contract.
export const TraceSamplers = {
  ALWAYS_ON: "always_on",
  ALWAYS_OFF: "always_off",
  TRACE_ID_RATIO: "traceidratio",
  PARENT_BASED_ALWAYS_ON: "parentbased_always_on",
  PARENT_BASED_ALWAYS_OFF: "parentbased_always_off",
  PARENT_BASED_TRACE_ID_RATIO: "parentbased_traceidratio",
} as const;

export type TraceSampler = ValueOf<typeof TraceSamplers>;

export const TracingStatuses = {
  ON: "on",
  OFF: "off",
} as const;

export type TracingStatus = ValueOf<typeof TracingStatuses>;

export const StopTracingOutcomes = {
  OFF: "off",
  FLUSHED: "flushed",
  FAILED: "failed",
  TIMED_OUT: "timed-out",
} as const;

export type StopTracingOutcome = ValueOf<typeof StopTracingOutcomes>;

export interface SamplerConfig {
  name: TraceSampler;
  /** The `traceidratio` probability, 0 to 1; ignored by the other samplers. */
  ratio: number;
}

export interface TracingConfig {
  /** The full OTLP/HTTP traces URL, `/v1/traces` included. */
  url: string;
  headers: Record<string, string>;
  /** `service.name`, which wins over one in `resourceAttributes`. */
  serviceName: string;
  resourceAttributes: Record<string, string>;
  sampler: SamplerConfig;
}

export interface StartTracingOptions {
  /** Ambient env, injected by the telemetry preload (never read here). */
  env: NodeJS.ProcessEnv;
  /** `service.name` unless `OTEL_SERVICE_NAME` overrides it. */
  serviceName: string;
  /** Where export failures and SDK warnings land. */
  log: TracingLog;
  /** Inbound paths that open no OTel span beyond the probes, by prefix. */
  untracedPathPrefixes?: readonly string[];
  /** Test seam: receives spans instead of the OTLP exporter. */
  exporter?: SpanExporter;
}

export type TracingLog = Pick<Logger, "warn">;
