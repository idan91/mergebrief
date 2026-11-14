import type { ValueOf } from "types/utils";

/** GitHub's account `type`, in GitHub's own casing. */
export const GitHubAccountTypes = {
  USER: "User",
  BOT: "Bot",
  ORGANIZATION: "Organization",
} as const;
export type GitHubAccountType = ValueOf<typeof GitHubAccountTypes>;

/** GitHub's `repository.visibility`; `internal` is readable by the whole enterprise. */
export const RepositoryVisibilities = {
  PUBLIC: "public",
  PRIVATE: "private",
  INTERNAL: "internal",
} as const;
export type RepositoryVisibility = ValueOf<typeof RepositoryVisibilities>;
