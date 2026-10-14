import type { CatalogOperation } from "../../product-operations/catalog";

/** The response body: the catalog's fields per operation plus its identity. */
export interface CapabilitiesBody {
  readonly operations: readonly CatalogOperation[];
  readonly catalogFingerprint: string;
}
