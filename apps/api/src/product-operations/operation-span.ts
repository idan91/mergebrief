import type { ProductOperationId } from "contract";
import type { Env, MiddlewareHandler } from "hono/types";
import { traceStep } from "logging";
import { HttpStatuses } from "types/http";
import { isServerFault } from "../shared-errors/on-error";

/**
 * One span per operation, named by its catalog id, around its policy gate and
 * handlers. A throw reaches here before the router's onError renders it, so
 * only a throw that answers 5xx, or a returned 5xx, marks the span failed.
 */
export function traceOperation<E extends Env>(
  id: ProductOperationId,
): MiddlewareHandler<E> {
  return (context, next) =>
    traceStep(
      id,
      { "mergebrief.operation": id },
      async (span) => {
        await next();
        if (context.res.status >= HttpStatuses.INTERNAL_SERVER_ERROR) {
          span.markFailed();
        }
      },
      { isFailure: isServerFault },
    );
}
