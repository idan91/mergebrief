import type { ValueOf } from "types/utils";

export const GitHubAppAuthorizationActions = {
  REVOKED: "revoked",
} as const;
export type GitHubAppAuthorizationAction = ValueOf<
  typeof GitHubAppAuthorizationActions
>;

/**
 * A run starting or finishing; a rerun request changes no run until GitHub
 * creates one. A run created unfinished is ignored: queued or in progress, it
 * meets no condition, and its completion wakes the head.
 */
export const CheckRunActions = {
  CREATED: "created",
  COMPLETED: "completed",
} as const;
export type CheckRunAction = ValueOf<typeof CheckRunActions>;

/** GitHub's `author_association` values, in GitHub's own casing. */
export const AuthorAssociations = {
  OWNER: "OWNER",
  MEMBER: "MEMBER",
  COLLABORATOR: "COLLABORATOR",
  CONTRIBUTOR: "CONTRIBUTOR",
  FIRST_TIME_CONTRIBUTOR: "FIRST_TIME_CONTRIBUTOR",
  FIRST_TIMER: "FIRST_TIMER",
  MANNEQUIN: "MANNEQUIN",
  NONE: "NONE",
} as const;
export type AuthorAssociation = ValueOf<typeof AuthorAssociations>;

/** Authors GitHub ties to the repository itself; a caller reads an absent association as untrusted. */
export const TRUSTED_AUTHOR_ASSOCIATIONS: ReadonlySet<AuthorAssociation> =
  new Set([
    AuthorAssociations.OWNER,
    AuthorAssociations.MEMBER,
    AuthorAssociations.COLLABORATOR,
  ]);
