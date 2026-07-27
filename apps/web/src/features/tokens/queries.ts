// Flat at the feature root by the queries.ts convention (brief/queries.ts
// precedent): the feature's queryOptions door, referenced by routes.
// Query + mutations for the API-token settings section (BRIEF-17 PR 4). The
// list read goes through the isomorphic seam; mint and revoke are client-only
// fetches (mutations never run during SSR), same split as the org switcher.
import { queryOptions } from "@tanstack/react-query";

import { ApiError, ApiErrorKind, apiFetchJson } from "../../data/apiFetch";
import {
  parseMintedToken,
  parseTokensView,
  type MintedToken,
  type TokensView,
} from "./types";

export function tokensQueryOptions() {
  return queryOptions({
    queryKey: ["api-tokens"],
    queryFn: async (): Promise<TokensView> => {
      const path = "/api/auth/tokens";
      const body = await apiFetchJson(path);
      const parsed = parseTokensView(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorKind.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: 0,
    retry: false,
  });
}

export interface MintTokenInput {
  readonly name: string;
  readonly installationId: string;
  /** Whole days, or null for NO expiry; omitted = the server's 90d default. */
  readonly expiresInDays?: number | null;
}

function kindForStatus(status: number): ApiErrorKind {
  return status === 401
    ? ApiErrorKind.UNAUTHORIZED
    : status === 403
      ? ApiErrorKind.FORBIDDEN
      : status === 400
        ? ApiErrorKind.BAD_REQUEST
        : status === 404
          ? ApiErrorKind.NOT_FOUND
          : ApiErrorKind.UPSTREAM;
}

/** POST the mint; the response is the ONE body carrying token material. */
export async function mintToken(input: MintTokenInput): Promise<MintedToken> {
  const response = await fetch("/api/auth/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new ApiError(
      kindForStatus(response.status),
      response.status,
      "/api/auth/tokens",
    );
  }
  // The JSON parse is part of the boundary too (codex PR4 R2): a 201 with a
  // non-JSON body is the same typed MALFORMED as a wrong shape.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      ApiErrorKind.MALFORMED,
      response.status,
      "/api/auth/tokens",
    );
  }
  const parsed = parseMintedToken(body);
  if (!parsed.ok) {
    throw new ApiError(
      ApiErrorKind.MALFORMED,
      response.status,
      "/api/auth/tokens",
    );
  }
  return parsed.value;
}

/** DELETE = owner-scoped soft revoke; repeat revoke is an idempotent 200. */
export async function revokeToken(tokenId: string): Promise<void> {
  const path = `/api/auth/tokens/${tokenId}`;
  const response = await fetch(path, { method: "DELETE" });
  if (!response.ok) {
    throw new ApiError(kindForStatus(response.status), response.status, path);
  }
}
