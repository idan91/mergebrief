// The feature's queryOptions door, referenced by routes, and its two writes.
// Mint and revoke only ever run in the browser (mutations never run during
// SSR), and each throws its `ApiError` for the mutation's error state.
import { queryOptions } from "@tanstack/react-query";
import {
  ProductActionIds,
  ProductQueryIds,
  type MintTokenBody,
} from "contract";

import { request } from "../../data/request";
import { mintedTokenSchema, tokensViewSchema } from "./schemas";
import type { MintedToken, TokensView } from "./types";

function listTokens(): Promise<TokensView> {
  return request(ProductQueryIds.LIST_TOKENS, { params: {} }, tokensViewSchema);
}

export function buildTokensQueryOptions() {
  return queryOptions({
    queryKey: ["api-tokens"],
    queryFn: listTokens,
    staleTime: 0,
  });
}

/** The mint receipt is the ONE body carrying token material; an off-shape one is `malformed`. */
export function mintToken(body: MintTokenBody): Promise<MintedToken> {
  return request(
    ProductActionIds.MINT_TOKEN,
    { params: {}, body },
    mintedTokenSchema,
  );
}

/** Owner-scoped soft revoke; a repeat revoke is an idempotent 200. */
export async function revokeToken(tokenId: string): Promise<void> {
  await request(ProductActionIds.REVOKE_TOKEN, { params: { id: tokenId } });
}
