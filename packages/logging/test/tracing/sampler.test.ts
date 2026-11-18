import {
  context,
  ROOT_CONTEXT,
  SpanKind,
  trace,
  TraceFlags,
} from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace";
import { describe, expect, it } from "vitest";
import { buildSampler } from "../../src/tracing/sampler";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

function makeRemoteParent(sampled: boolean) {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: TRACE_ID,
    spanId: "00f067aa0ba902b7",
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  });
}

function decideFor(
  sampler: ReturnType<typeof buildSampler>,
  parent = context.active(),
) {
  return sampler.shouldSample(parent, TRACE_ID, "GET", SpanKind.SERVER, {}, [])
    .decision;
}

describe("buildSampler", () => {
  it("follows a caller's unsampled flag by default", () => {
    const sampler = buildSampler(
      { name: "parentbased_always_on", ratio: 1 },
      false,
    );
    const unsampledParent = makeRemoteParent(false);
    expect(decideFor(sampler, unsampledParent)).toBe(
      SamplingDecision.NOT_RECORD,
    );
  });

  it("applies its own root decision when it owns sampling", () => {
    const keeps = buildSampler(
      { name: "parentbased_always_on", ratio: 1 },
      true,
    );
    const unsampledParent = makeRemoteParent(false);
    expect(decideFor(keeps, unsampledParent)).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
    const drops = buildSampler(
      { name: "parentbased_always_off", ratio: 1 },
      true,
    );
    const sampledParent = makeRemoteParent(true);
    expect(decideFor(drops, sampledParent)).toBe(SamplingDecision.NOT_RECORD);
  });

  it("builds the plain samplers as given", () => {
    const alwaysOff = buildSampler({ name: "always_off", ratio: 1 }, true);
    const fullRatio = buildSampler({ name: "traceidratio", ratio: 1 }, false);

    expect(decideFor(alwaysOff)).toBe(SamplingDecision.NOT_RECORD);
    expect(decideFor(fullRatio)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });
});
