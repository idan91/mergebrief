// Hono-free: renders the committed registry as data. A CLI checks
// compatibility against this before driving an operation (fail-closed check,
// never negotiation).
import { computeCatalogFingerprint } from "../../product-operations/manifest";
import type { ProductOperationDescriptor } from "../../product-operations/types";

export const capabilitiesController = {
  buildCapabilities(operations: readonly ProductOperationDescriptor[]) {
    return {
      operations,
      catalogFingerprint: computeCatalogFingerprint(operations),
    };
  },
};
