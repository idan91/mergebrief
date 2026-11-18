// Hono-free: renders the committed registry as data. A CLI checks
// compatibility against this before driving an operation (fail-closed check,
// never negotiation).
import type { ReadCapabilitiesResponse } from "contract";
import { shapeCatalogOperations } from "../../product-operations/catalog";
import type { ProductOperationDescriptor } from "../../product-operations/types";

export const capabilitiesController = {
  buildCapabilities(
    operations: readonly ProductOperationDescriptor[],
  ): ReadCapabilitiesResponse {
    return {
      operations: shapeCatalogOperations(operations),
    };
  },
};
