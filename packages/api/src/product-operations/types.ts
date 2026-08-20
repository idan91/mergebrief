import { WriteClassification } from "persistence";

// The Product Operation taxonomy: every authenticated domain operation is a
// query (read-only) or an action (state-changing), classified by where its
// write lands. Descriptors are static metadata — they never touch a request.
export const OPERATION_KIND = {
  QUERY: "query",
  ACTION: "action",
} as const;

/**
 * Where a write lands — and, unchanged, the `api_token.scope` vocabulary. One
 * map for both keeps the scope check a lookup rather than a mapping, and the
 * CHECK constraint that pins it lives with the column, so `persistence` owns
 * the declaration and this is the api-side name for it.
 */
export const WRITE_CLASSIFICATION = WriteClassification;

/** A write that leaves the instance (GitHub reviews, comments, thread state). */
export type ExternalWriteClassification =
  typeof WRITE_CLASSIFICATION.EXTERNAL_WRITE;
/** A write confined to this instance's own state. */
export type PrivateWriteClassification =
  typeof WRITE_CLASSIFICATION.PRIVATE_WRITE;
export type ActionClassification =
  | PrivateWriteClassification
  | ExternalWriteClassification;

interface OperationDescriptorBase {
  /** Stable kebab-case identity — the manifest and CLI-map join key. */
  readonly id: string;
  /** False = web-only (credential/setup flows an agent must never drive). */
  readonly agentAvailable: boolean;
  /**
   * `METHOD /full/composed/path` — stamped by the router from the mount
   * prefixes, never written by hand.
   */
  readonly endpoint: string;
}

export interface ProductQueryDescriptor extends OperationDescriptorBase {
  readonly kind: typeof OPERATION_KIND.QUERY;
  readonly classification: typeof WRITE_CLASSIFICATION.READ;
}

export interface ProductActionDescriptor extends OperationDescriptorBase {
  readonly kind: typeof OPERATION_KIND.ACTION;
  readonly classification: ActionClassification;
}

export type ProductOperationDescriptor =
  | ProductQueryDescriptor
  | ProductActionDescriptor;
