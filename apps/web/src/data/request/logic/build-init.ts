import {
  buildOperationPath,
  ProductOperations,
  type ProductOperationId,
} from "contract";
import type { Mutable } from "types";

import type { ApiFetchInit } from "../../apiFetch";
import { CONTENT_TYPE_HEADER, JSON_CONTENT_TYPE } from "../consts";
import type { ApiRequest } from "../types";

function buildQuery(query: ApiRequest<ProductOperationId>["query"]): string {
  if (query === undefined) {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      search.append(key, value);
    }
  }

  const encoded = search.toString();
  const suffix = encoded === "" ? "" : `?${encoded}`;
  return suffix;
}

export function buildPath<Id extends ProductOperationId>(
  operation: Id,
  args: ApiRequest<Id>,
): string {
  const path = buildOperationPath(operation, args.params);
  const url = `${path}${buildQuery(args.query)}`;
  return url;
}

function hasHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

export function buildInit<Id extends ProductOperationId>(
  operation: Id,
  args: ApiRequest<Id>,
): ApiFetchInit {
  const headers: Record<string, string> = { ...args.headers };
  const init: Mutable<ApiFetchInit> = {
    method: ProductOperations[operation].method,
  };

  if (args.body instanceof Blob) {
    init.body = args.body;
  } else if (args.body !== undefined) {
    init.body = JSON.stringify(args.body);
    if (!hasHeader(headers, CONTENT_TYPE_HEADER)) {
      headers[CONTENT_TYPE_HEADER] = JSON_CONTENT_TYPE;
    }
  }

  if (Object.keys(headers).length > 0) {
    init.headers = headers;
  }
  if (args.signal !== undefined) {
    init.signal = args.signal;
  }
  if (args.unauthorizedIsSignedOut !== undefined) {
    init.unauthorizedIsSignedOut = args.unauthorizedIsSignedOut;
  }
  if (args.unauthorizedLeavesForSignIn !== undefined) {
    init.unauthorizedLeavesForSignIn = args.unauthorizedLeavesForSignIn;
  }
  return init;
}
