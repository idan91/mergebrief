import type { ValueOf } from "./utils";

export const DispositionDecisions = {
  ADDRESSED: "addressed",
  DISMISSED: "dismissed",
} as const;
export type DispositionDecision = ValueOf<typeof DispositionDecisions>;

/**
 * How a disposition reached the session it sits in. Null when the decision
 * was made in this session.
 */
export const DispositionCarryStatuses = {
  NEW: "new",
  REOPENED: "reopened",
  SETTLED: "settled",
  DROPPED: "dropped",
} as const;
export type DispositionCarryStatus = ValueOf<typeof DispositionCarryStatuses>;

/**
 * A one-value vocabulary today; null means the evidence the decision claimed
 * is still present.
 */
export const DispositionEvidenceStatuses = {
  MISSING_EVIDENCE: "missing-evidence",
} as const;
export type DispositionEvidenceStatus = ValueOf<
  typeof DispositionEvidenceStatuses
>;

/**
 * What an addressing decision points at. The kind is what makes the evidence
 * `ref` readable: a draft comment's row id, a Chunk id, or the reviewer's own
 * words. Null on a dismissal, which carries its `reason` instead.
 */
export const DispositionEvidenceKinds = {
  LINKED_COMMENT: "linked-comment",
  CHUNK_REVIEWED: "chunk-reviewed",
  MANUAL_NOTE: "manual-note",
} as const;
export type DispositionEvidenceKind = ValueOf<typeof DispositionEvidenceKinds>;

/** The evidence an `address-risk` claims; `ref` reads per `kind`. */
export interface DispositionEvidence {
  readonly kind: DispositionEvidenceKind;
  /** A draft-comment row id, a Chunk id, or the note itself; null when empty. */
  readonly ref: string | null;
}
