import type { ValueOf } from "types/utils";
import type { GrantRowId } from "../types";

export const TokenMintErrorCodes = {
  /** The minting session was deleted (a logout) before the mint locked it. */
  SESSION_GONE: "session-gone",
} as const;
export type TokenMintErrorCode = ValueOf<typeof TokenMintErrorCodes>;

/** The `github_grant` columns that hold a sealed token, as the AAD names them. */
export const GrantSealedColumns = {
  ACCESS_TOKEN: "gh_token",
  REFRESH_TOKEN: "gh_refresh_token",
} as const;
export type GrantSealedColumn = ValueOf<typeof GrantSealedColumns>;

/** Where a sealed token lives: a ciphertext opens only in this row and column. */
export interface GrantSealBinding {
  readonly grantId: GrantRowId;
  readonly column: GrantSealedColumn;
}
