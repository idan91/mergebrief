import type { ValueOf } from "types/utils";

export interface MentionableUser {
  readonly login: string;
  /** Display name; absent when the user never set one. */
  readonly name?: string;
  readonly avatarUrl: string;
}

export interface SearchMentionableUsersInput {
  readonly owner: string;
  readonly repo: string;
  /** What the reviewer typed after `@`. */
  readonly query: string;
}

export interface MentionableTeam {
  /** `org/slug`, the text after `@` in a team mention. */
  readonly combinedSlug: `${string}/${string}`;
  readonly name: string;
}

export interface SearchMentionableTeamsInput {
  /** The org that owns the repository; a person-owned repo has no teams. */
  readonly org: string;
  readonly query: string;
}

export const MentionTargetKinds = {
  USER: "user",
  TEAM: "team",
} as const;
export type MentionTargetKind = ValueOf<typeof MentionTargetKinds>;

/** `@login`; GitHub resolves an org login the same way. */
export interface UserMentionTarget {
  readonly kind: typeof MentionTargetKinds.USER;
  readonly login: string;
}

/** `@org/slug`. */
export interface TeamMentionTarget {
  readonly kind: typeof MentionTargetKinds.TEAM;
  readonly org: string;
  readonly slug: string;
}

export type MentionTarget = UserMentionTarget | TeamMentionTarget;

export interface ResolveMentionTargetsInput {
  readonly targets: readonly MentionTarget[];
}

/** The targets GitHub shows the viewer, in GitHub's casing. */
export interface ResolvedMentionTargets {
  readonly users: readonly string[];
  readonly teams: readonly `${string}/${string}`[];
}
