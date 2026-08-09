import type { Generator, TokenUsage } from "generators";

/**
 * Decorate a Generator so every request reports usage into `sink` — how the
 * harness observes cost without `categorize()` knowing about usage at all.
 */
export function withUsageSink(
  inner: Generator,
  sink: (usage: TokenUsage) => void,
): Generator {
  return {
    generate: (req) => inner.generate({ ...req, onUsage: sink }),
    origin: (effort) => inner.origin(effort),
  };
}
