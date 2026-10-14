// Hono-free: renders the committed registry as data. A CLI checks
// compatibility against this before driving an operation (fail-closed check,
// never negotiation).
import { shapeCatalogOperations } from "../../product-operations/catalog";
import type { ProductOperationDescriptor } from "../../product-operations/types";

export const capabilitiesController = {
  buildCapabilities(operations: readonly ProductOperationDescriptor[]) {
    return {
      operations: shapeCatalogOperations(operations),
    };
  },
};
