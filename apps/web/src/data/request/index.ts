import type { ProductOperationId } from "contract";
import type { z } from "zod/v4";

import { buildInit, buildPath } from "./logic/build-init";
import { fetchOk, readJson, readParsed, readText } from "./logic/read-response";
import type { ApiRequest } from "./types";

export { buildPath } from "./logic/build-init";
export { readFailureKind } from "./logic/failure-kind";

/** Path and method from the operation's table row. A non-2xx throws `ApiError`; a 204, unreadable or off-shape body throws it as `malformed`. */
export function request<Id extends ProductOperationId, Output>(
  operation: Id,
  args: ApiRequest<Id>,
  schema: z.ZodType<Output>,
): Promise<Output>;
/** Path and method from the operation's table row. A non-2xx throws `ApiError`; the body comes back unchecked, `undefined` when empty. */
export function request<Id extends ProductOperationId>(
  operation: Id,
  args: ApiRequest<Id>,
): Promise<unknown>;
export async function request<Id extends ProductOperationId, Output>(
  operation: Id,
  args: ApiRequest<Id>,
  schema?: z.ZodType<Output>,
): Promise<unknown> {
  const path = buildPath(operation, args);
  const response = await fetchOk(path, buildInit(operation, args));

  if (schema === undefined) {
    return readJson(response, path);
  }
  return readParsed(response, path, schema);
}

/** The 2xx body as text. A non-2xx throws `ApiError`; a 204 or unreadable body throws it as `malformed`. */
export async function requestText<Id extends ProductOperationId>(
  operation: Id,
  args: ApiRequest<Id>,
): Promise<string> {
  const path = buildPath(operation, args);
  const response = await fetchOk(path, buildInit(operation, args));
  return readText(response, path);
}
