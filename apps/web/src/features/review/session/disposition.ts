import type { RiskEvidence } from "../utils/state";
import type { DispositionKinds } from "./types";

/**
 * A flag's Disposition as one discriminated union. `addressed` carries
 * optional evidence so "addressed, pending evidence" stays a representable
 * state (it still yields a missing-evidence item). Keyed by brief-local flag
 * id for now; region-anchoring is deferred behind the store interface.
 */
export type Disposition =
  | { kind: typeof DispositionKinds.OPEN }
  | { kind: typeof DispositionKinds.ADDRESSED; evidence?: RiskEvidence }
  | { kind: typeof DispositionKinds.DISMISSED; reason: string };

/** The bulk payload shared across open/dismissed dispositions (no evidence). */
export type BulkDisposition =
  | { kind: typeof DispositionKinds.OPEN }
  | { kind: typeof DispositionKinds.DISMISSED; reason: string };
