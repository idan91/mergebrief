import type { CatalogOperation } from "contract";
import type { ProductOperationDescriptor } from "./types";

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
