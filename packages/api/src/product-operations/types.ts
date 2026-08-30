import { WriteClassifications, type WriteClassification } from "persistence";

// The Product Operation taxonomy: every authenticated domain operation is a
// query (read-only) or an action (state-changing), classified by where its
// write lands. Descriptors are otherwise static metadata; the one request-time
// read is the action path comparing `classification` against the credential's
// scope.
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
export const WRITE_CLASSIFICATION = WriteClassifications;

/** A write that leaves the instance (GitHub reviews, comments, thread state). */
export type ExternalWriteClassification =
  typeof WRITE_CLASSIFICATION.EXTERNAL_WRITE;
/** A write confined to this instance's own state. */
export type PrivateWriteClassification =
  typeof WRITE_CLASSIFICATION.PRIVATE_WRITE;
export type ActionClassification =
  | PrivateWriteClassification
  | ExternalWriteClassification;

/**
 * The ladder, cumulative left to right: a credential scoped at one rung reaches
 * every operation classified at or below it. Ranks — not the order of a map —
 * are what the check compares, so adding a rung means placing it here.
 */
const SCOPE_RANK = {
  [WRITE_CLASSIFICATION.READ]: 0,
  [WRITE_CLASSIFICATION.PRIVATE_WRITE]: 1,
  [WRITE_CLASSIFICATION.EXTERNAL_WRITE]: 2,
} as const satisfies Record<WriteClassification, number>;

/** Whether a credential's scope reaches an operation's write class. */
export function scopeReaches(
  scope: WriteClassification,
  classification: WriteClassification,
): boolean {
  return SCOPE_RANK[scope] >= SCOPE_RANK[classification];
}

/** Narrow an unknown (a context variable, a wire value) to the vocabulary. */
export function isWriteClassification(
  value: unknown,
): value is WriteClassification {
  return Object.values(WRITE_CLASSIFICATION).some((known) => known === value);
}

interface OperationDescriptorBase {
  /** Stable kebab-case identity — the manifest and CLI-map join key. */
  readonly id: string;
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
