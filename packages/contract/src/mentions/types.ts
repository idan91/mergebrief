import type { ValueOf } from "types";

export const MentionQueryKeys = {
  /** What the reviewer typed after `@`. */
  QUERY: "q",
  /** Comma-separated `login` and `org/slug` targets. */
  TARGETS: "targets",
} as const;
export type MentionQueryKey = ValueOf<typeof MentionQueryKeys>;

export interface MentionUserView {
  readonly login: string;
  /** Absent when the user never set a display name. */
  readonly name?: string;
  readonly avatarUrl: string;
}

export interface MentionTeamView {
  readonly combinedSlug: `${string}/${string}`;
  readonly name: string;
}

/** `search-mention-suggestions`. */
export interface MentionSuggestionsResponse {
  readonly users: readonly MentionUserView[];
  readonly teams: readonly MentionTeamView[];
}

/** `resolve-mention-targets`: the targets GitHub shows the viewer, in GitHub's casing. */
export interface MentionTargetsResponse {
  readonly users: readonly string[];
  readonly teams: readonly `${string}/${string}`[];
}
