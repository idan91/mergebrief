import type { ProductOperationDescriptor } from "./types";

/** The wire catalog's fields; the descriptor's policy stays api-side. */
export interface CatalogOperation {
  readonly id: ProductOperationDescriptor["id"];
  readonly kind: ProductOperationDescriptor["kind"];
  readonly classification: ProductOperationDescriptor["classification"];
  readonly endpoint: ProductOperationDescriptor["endpoint"];
}

/** Field order pinned here, not by descriptor construction order. */
export function shapeCatalogOperations(
  operations: readonly ProductOperationDescriptor[],
): CatalogOperation[] {
  return operations.map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    classification: operation.classification,
    endpoint: operation.endpoint,
  }));
}
