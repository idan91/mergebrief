// The feature's queryOptions door, referenced by routes. Every call goes
// through the isomorphic boundary; mint and revoke only ever run in the
// browser (mutations never run during SSR).
import { queryOptions } from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  apiFetchJson,
  errorFromResponse,
} from "../../data/apiFetch";
import { parseMintedToken, parseTokensView } from "./schemas";
import type { MintedToken, TokensView, TokenScope } from "./types";

export function buildTokensQueryOptions() {
  return queryOptions({
    queryKey: ["api-tokens"],
    queryFn: async (): Promise<TokensView> => {
      const path = "/api/auth/tokens";
      const body = await apiFetchJson(path);
      const parsed = parseTokensView(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCodes.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: 0,
    retry: false,
  });
}

export interface MintTokenInput {
  readonly name: string;
  /** REQUIRED: the server refuses a mint that names no reach. */
  readonly scope: TokenScope;
  /** Whole days, or null for NO expiry; omitted = the server's 90d default. */
  readonly expiresInDays?: number | null;
}

/** POST the mint; the response is the ONE body carrying token material. */
export async function mintToken(input: MintTokenInput): Promise<MintedToken> {
  const response = await apiFetch("/api/auth/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await errorFromResponse(response, "/api/auth/tokens");
  }
  // The JSON parse is part of the boundary too: a 201 with a non-JSON body is
  // the same typed MALFORMED as a wrong shape.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      ApiErrorCodes.MALFORMED,
      response.status,
      "/api/auth/tokens",
    );
  }
  const parsed = parseMintedToken(body);
  if (!parsed.ok) {
    throw new ApiError(
      ApiErrorCodes.MALFORMED,
      response.status,
      "/api/auth/tokens",
    );
  }
  return parsed.value;
}

/** DELETE = owner-scoped soft revoke; repeat revoke is an idempotent 200. */
export async function revokeToken(tokenId: string): Promise<void> {
  const path = `/api/auth/tokens/${tokenId}`;
  const response = await apiFetch(path, { method: "DELETE" });
  if (!response.ok) {
    throw await errorFromResponse(response, path);
  }
}
