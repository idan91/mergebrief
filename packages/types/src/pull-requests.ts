import type { ValueOf } from "./utils";

/**
 * Which door created a pull request: the App-installation webhook world or
 * the signed-in URL box. Audit entries carry the same vocabulary.
 */
export const PullRequestSources = {
  INSTALLATION: "installation",
  URL: "url",
} as const;
export type PullRequestSource = ValueOf<typeof PullRequestSources>;

export const PrStates = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
} as const;
export type PrState = ValueOf<typeof PrStates>;
