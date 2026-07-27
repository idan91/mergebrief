import type { RiskEvidence } from "../utils/state";

/**
 * A flag's Disposition (CONTEXT.md) as one discriminated union, replacing the
 * three parallel maps (status / evidence / reason). `addressed` carries optional
 * evidence so "addressed, pending evidence" stays a real, representable state
 * (it still yields a missing-evidence item). Keyed by brief-local flag id for
 * now — region-anchoring (ADR 0007) is deferred behind the store interface.
 */
export type Disposition =
  | { kind: "open" }
  | { kind: "addressed"; evidence?: RiskEvidence }
  | { kind: "dismissed"; reason: string };

/** The bulk payload shared across open/dismissed dispositions (no evidence). */
export type BulkDisposition =
  | { kind: "open" }
  | { kind: "dismissed"; reason: string };
