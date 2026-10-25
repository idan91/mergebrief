import type { ValueOf } from "types/utils";

/** GitHub's account `type`, in GitHub's own casing. */
export const GitHubAccountTypes = {
  USER: "User",
  BOT: "Bot",
  ORGANIZATION: "Organization",
} as const;
export type GitHubAccountType = ValueOf<typeof GitHubAccountTypes>;
