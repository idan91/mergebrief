import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
} from "@opentelemetry/sdk-trace";
import { TraceSamplers, type SamplerConfig } from "./types";

function buildRootSampler({ name, ratio }: SamplerConfig): Sampler {
  const roots: Record<SamplerConfig["name"], () => Sampler> = {
    [TraceSamplers.ALWAYS_ON]: () => new AlwaysOnSampler(),
    [TraceSamplers.ALWAYS_OFF]: () => new AlwaysOffSampler(),
    [TraceSamplers.TRACE_ID_RATIO]: () => new TraceIdRatioBasedSampler(ratio),
    [TraceSamplers.PARENT_BASED_ALWAYS_ON]: () => new AlwaysOnSampler(),
    [TraceSamplers.PARENT_BASED_ALWAYS_OFF]: () => new AlwaysOffSampler(),
    [TraceSamplers.PARENT_BASED_TRACE_ID_RATIO]: () =>
      new TraceIdRatioBasedSampler(ratio),
  };
  return roots[name]();
}

const PARENT_BASED_SAMPLERS: ReadonlySet<string> = new Set([
  TraceSamplers.PARENT_BASED_ALWAYS_ON,
  TraceSamplers.PARENT_BASED_ALWAYS_OFF,
  TraceSamplers.PARENT_BASED_TRACE_ID_RATIO,
]);

/**
 * The spec samplers. With `ownsSamplingDecision`, a remote parent's sampled
 * flag gets the root decision instead of being followed: on the
 * internet-facing tier that flag is whatever a client sent.
 */
export function buildSampler(
  config: SamplerConfig,
  ownsSamplingDecision: boolean,
): Sampler {
  const root = buildRootSampler(config);
  if (!PARENT_BASED_SAMPLERS.has(config.name)) {
    return root;
  }
  if (!ownsSamplingDecision) {
    return new ParentBasedSampler({ root });
  }
  return new ParentBasedSampler({
    root,
    remoteParentSampled: root,
    remoteParentNotSampled: root,
  });
}
