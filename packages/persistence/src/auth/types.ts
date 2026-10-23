import type { ValueOf } from "types/utils";

export const TokenMintErrorCodes = {
  /** The minting session was deleted (a logout) before the mint locked it. */
  SESSION_GONE: "session-gone",
} as const;
export type TokenMintErrorCode = ValueOf<typeof TokenMintErrorCodes>;
