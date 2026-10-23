import type { ValueOf } from "types/utils";

export const GitHubAppAuthorizationActions = {
  REVOKED: "revoked",
} as const;
export type GitHubAppAuthorizationAction = ValueOf<
  typeof GitHubAppAuthorizationActions
>;
