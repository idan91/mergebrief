// A command's request URL from the operation table. The query keeps the
// order given and `encodeURIComponent`, the bytes these commands always sent.
import {
  buildOperationPath,
  type OperationParams,
  type ProductOperationId,
} from "contract";

export function buildRequestPath<Id extends ProductOperationId>(
  id: Id,
  params: OperationParams<Id>,
  query?: Readonly<Record<string, string>>,
): string {
  const path = buildOperationPath(id, params);
  if (query === undefined) {
    return path;
  }

  const pairs = Object.entries(query).map(
    ([key, value]) => `${key}=${encodeURIComponent(value)}`,
  );
  const requestPath = `${path}?${pairs.join("&")}`;
  return requestPath;
}
