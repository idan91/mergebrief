// Mounted at the root ahead of every route, so no handler parses a body past
// the cap and a route added later is covered without opting in. The attachment
// upload is the one exemption: it streams its body under its own larger cap.
import { ApiErrorCodes, ProductActionIds } from "contract";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ProductOperationRegistry } from "./product-operations/registry";
import { createOperationResolver } from "./product-operations/resolve-operation";
import { MAX_REQUEST_BODY_BYTES } from "./routes/wire-bounds";
import { PayloadTooLarge } from "./shared-errors/api-error";

function refuseOversizedBody(): never {
  throw new PayloadTooLarge(ApiErrorCodes.REQUEST_TOO_LARGE);
}

export function createRequestBodyLimit(
  registry: ProductOperationRegistry,
): MiddlewareHandler {
  const resolveOperation = createOperationResolver(registry);
  const limit = bodyLimit({
    maxSize: MAX_REQUEST_BODY_BYTES,
    onError: refuseOversizedBody,
  });

  return async (c, next) => {
    if (resolveOperation(c)?.id === ProductActionIds.UPLOAD_ATTACHMENT) {
      return next();
    }
    return limit(c, next);
  };
}
