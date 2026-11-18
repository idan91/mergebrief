import type { AccessLevel } from "types/access-levels";

import type { ProductEndpoint } from "./operations";
import type { OperationKind, ProductOperationId } from "./operations/types";

/** One registered operation as the catalog lists it; policy stays api-side. */
export interface CatalogOperation {
  readonly id: ProductOperationId;
  readonly kind: OperationKind;
  readonly classification: AccessLevel;
  readonly endpoint: ProductEndpoint;
}

/** What `read-capabilities` answers: every operation the server registered. */
export interface ReadCapabilitiesResponse {
  readonly operations: readonly CatalogOperation[];
}
