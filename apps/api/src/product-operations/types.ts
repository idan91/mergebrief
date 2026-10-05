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

interface OperationDescriptorBase {
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
