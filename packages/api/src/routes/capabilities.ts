// `GET /api/capabilities` — the composed registry served as data, so a CLI
// can check compatibility before driving an operation (fail-closed check,
// never negotiation). Itself a registered Product Query: the endpoint
// appears in its own output.
import { PRODUCT_QUERY_ID } from "../product-operations/ids";
import { computeCatalogFingerprint } from "../product-operations/manifest";
import { productOperationRegistry } from "../product-operations/registry";
import {
  productRouter,
  type ProductRouter,
} from "../product-operations/product-router";
import {
  WRITE_CLASSIFICATION,
  type ProductOperationDescriptor,
} from "../product-operations/types";
import type { AuthRouteDeps } from "./auth/session";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "./authz";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The response body — descriptors verbatim plus the catalog identity. */
interface CapabilitiesBody {
  readonly operations: readonly ProductOperationDescriptor[];
  readonly catalogFingerprint: string;
}

export function capabilitiesRoute(
  deps: AuthRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  app.use("/", sessionLayer(deps), accessStampLayer());
  // The registry is immutable after the root commit; render once, not per
  // request. Lazy because commit runs after this mount.
  let cached: CapabilitiesBody | undefined;
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_CAPABILITIES,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/",
    (c) => {
      if (cached === undefined) {
        const operations = productOperationRegistry.list();
        cached = {
          operations,
          catalogFingerprint: computeCatalogFingerprint(operations),
        };
      }
      return c.json(cached, 200, NO_STORE);
    },
  );
  return app;
}
