import { WriteClassifications, type WriteClassification } from "persistence";

export const OperationKinds = {
  QUERY: "query",
  ACTION: "action",
} as const;

export type ExternalWriteClassification =
  typeof WriteClassifications.EXTERNAL_WRITE;
export type PrivateWriteClassification =
  typeof WriteClassifications.PRIVATE_WRITE;
export type ActionClassification =
  | PrivateWriteClassification
  | ExternalWriteClassification;

// Ranks, not map order, are what the check compares; adding a rung means placing it here.
const ScopeRanks = {
  [WriteClassifications.READ]: 0,
  [WriteClassifications.PRIVATE_WRITE]: 1,
  [WriteClassifications.EXTERNAL_WRITE]: 2,
} as const satisfies Record<WriteClassification, number>;

export function scopeReaches(
  scope: WriteClassification,
  classification: WriteClassification,
): boolean {
  return ScopeRanks[scope] >= ScopeRanks[classification];
}

export function isWriteClassification(
  value: unknown,
): value is WriteClassification {
  return Object.values(WriteClassifications).some((known) => known === value);
}

/**
 * What the router enforces before an operation's handler runs, in the order
 * the fields are listed after the scope check. Every declaration states all
 * four: a route added later cannot inherit a permissive default by omission.
 */
export interface OperationPolicy {
  /** A Bearer token answers 403 `human-only`: the act signs as the reviewer. */
  readonly humanOnly: boolean;
  /** Without the push bit the operation answers 404. */
  readonly pushRequired: boolean;
  /** Outside an Installation the surface does not exist: 404. */
  readonly installationOnly: boolean;
  /** The pull request row loads before the handler; a miss is 404. */
  readonly rowRequired: boolean;
}

interface OperationDescriptorBase extends OperationPolicy {
  readonly id: string;
  /** `METHOD /full/composed/path`, stamped by the router from the mount prefixes. */
  readonly endpoint: string;
}

export interface ProductQueryDescriptor extends OperationDescriptorBase {
  readonly kind: typeof OperationKinds.QUERY;
  readonly classification: typeof WriteClassifications.READ;
}

export interface ProductActionDescriptor extends OperationDescriptorBase {
  readonly kind: typeof OperationKinds.ACTION;
  readonly classification: ActionClassification;
}

export type ProductOperationDescriptor =
  | ProductQueryDescriptor
  | ProductActionDescriptor;
