import type { Context } from "hono";
import type { ProductOperationRegistry } from "../../product-operations/registry";
import type { AuthzEnv } from "../authz";
import capabilitiesController from "./controller";
import type { CapabilitiesBody } from "./types";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The registry is immutable after the root commit; render once, not per
 * request. Lazy because commit runs after the route mounts. */
export default function createHandlers(registry: ProductOperationRegistry) {
  let cached: CapabilitiesBody | undefined;
  return {
    readCapabilities: (c: Context<AuthzEnv>) => {
      cached ??= capabilitiesController.buildCapabilities(registry.list());
      return c.json(cached, 200, NO_STORE);
    },
  };
}
