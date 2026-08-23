import type { ProductOperationDescriptor } from "../../product-operations/types";

/** The response body — descriptors verbatim plus the catalog identity. */
export interface CapabilitiesBody {
  readonly operations: readonly ProductOperationDescriptor[];
  readonly catalogFingerprint: string;
}
