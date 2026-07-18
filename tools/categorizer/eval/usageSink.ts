import type { Generator, TokenUsage } from "generators";

/**
 * Decorate a Generator so every request reports usage into `sink` —
 * how the harness observes cost without `categorize()` knowing about
 * usage at all (the callback rides the GenerateRequest, BRIEF-59 PR 1).
 */
export function withUsageSink(
  inner: Generator,
  sink: (usage: TokenUsage) => void,
): Generator {
  return {
    generate: (req) => inner.generate({ ...req, onUsage: sink }),
    provenance: (effort) => inner.provenance(effort),
  };
}
