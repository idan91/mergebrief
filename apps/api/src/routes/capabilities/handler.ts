import type { ReadCapabilitiesResponse } from "contract";
import type { Context } from "hono";
import type { ProductOperationRegistry } from "../../product-operations/registry";
import type { AuthzEnv } from "../../access/types";
import { capabilitiesController } from "./controller";
import { HttpStatuses } from "types/http";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The registry is immutable after the root commit; render once, not per
 * request. Lazy because commit runs after the route mounts. */
export function createCapabilitiesHandlers(registry: ProductOperationRegistry) {
  let cached: ReadCapabilitiesResponse | undefined;
  return {
    readCapabilities: (c: Context<AuthzEnv>) => {
      cached ??= capabilitiesController.buildCapabilities(registry.list());
      return c.json(cached, HttpStatuses.OK, NO_STORE);
    },
  };
}
