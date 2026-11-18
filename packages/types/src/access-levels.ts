import type { ValueOf } from "./utils";

/**
 * Cumulative left to right: `read` < `private-write` < `external-write`. A
 * Product Operation's classification and `api_token.scope` share it.
 */
export const AccessLevels = {
  READ: "read",
  PRIVATE_WRITE: "private-write",
  EXTERNAL_WRITE: "external-write",
} as const;
export type AccessLevel = ValueOf<typeof AccessLevels>;
