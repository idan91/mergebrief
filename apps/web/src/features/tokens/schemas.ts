import { z } from "zod/v4";
import type { Result } from "types/utils";

import { dropNullKeys } from "@web/utils/drop-keys";
import { parseWithSchema } from "@web/utils/parse-with-schema";

import { TokenScopes, type MintedToken, type TokensView } from "./types";

export const apiTokenSchema = dropNullKeys(
  z.object({
    id: z.string(),
    name: z.string(),
    scope: z.enum(TokenScopes),
    userLogin: z.string().exactOptional(),
    expiresAt: z.string().exactOptional(),
    lastUsedAt: z.string().exactOptional(),
    revokedAt: z.string().exactOptional(),
    createdAt: z.string(),
  }),
  ["userLogin", "expiresAt", "lastUsedAt", "revokedAt"],
).readonly();

export const tokensViewSchema = z
  .object({ tokens: z.array(apiTokenSchema) })
  .readonly();

export const mintedTokenSchema = z
  .object({ token: z.string(), apiToken: apiTokenSchema })
  .readonly();

export function parseTokensView(value: unknown): Result<TokensView, string> {
  return parseWithSchema(tokensViewSchema, value);
}

export function parseMintedToken(value: unknown): Result<MintedToken, string> {
  return parseWithSchema(mintedTokenSchema, value);
}
