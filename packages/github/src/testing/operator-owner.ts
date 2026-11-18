import type { ReviewerId } from "persistence";
import { isOperatorToken } from "../client/operator";
import type { OperatorToken, OwnedOperatorToken } from "../client/types";

function requireOperatorToken(token: string): OperatorToken {
  if (!isOperatorToken(token)) {
    throw new Error("a stub operator token must be non-empty");
  }
  return token;
}

/** An operator token whose owner lookup already resolved to `ownerId`. */
export function stubOwnedOperatorToken(
  token: string,
  ownerId: ReviewerId,
): OwnedOperatorToken {
  return {
    token: requireOperatorToken(token),
    isOwnedBy: (reviewerId) => reviewerId === ownerId,
    isLookupPending: () => false,
  };
}

/** An operator token whose owner lookup has not resolved yet. */
export function stubPendingOperatorToken(token: string): OwnedOperatorToken {
  return {
    token: requireOperatorToken(token),
    isOwnedBy: () => false,
    isLookupPending: () => true,
  };
}
