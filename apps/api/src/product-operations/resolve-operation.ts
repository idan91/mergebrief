import type { Context } from "hono";
import { matchedRoutes } from "hono/route";
import type { ProductOperationRegistry } from "./registry";
import type { ProductOperationDescriptor } from "./types";

export type OperationResolver = (
  c: Context,
) => ProductOperationDescriptor | undefined;

/** `METHOD /full/path` → descriptor, built once off the committed registry. */
function buildEndpointIndex(
  registry: ProductOperationRegistry,
): ReadonlyMap<string, ProductOperationDescriptor> {
  return new Map(
    registry.list().map((descriptor) => [descriptor.endpoint, descriptor]),
  );
}

/**
 * The operation a request routed to, read off the MATCHED routes rather than
 * a handler-set variable: matching happens before any middleware runs, so a
 * request refused ahead of its handler still names its operation.
 */
export function createOperationResolver(
  registry: ProductOperationRegistry,
): OperationResolver {
  // The registry is committed after the app composes, so index on first use.
  let index: ReadonlyMap<string, ProductOperationDescriptor> | undefined;

  return (c) => {
    index ??= buildEndpointIndex(registry);
    for (const route of matchedRoutes(c)) {
      const descriptor = index.get(`${route.method} ${route.path}`);
      if (descriptor !== undefined) {
        return descriptor;
      }
    }
    return undefined;
  };
}
