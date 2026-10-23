import type { ValueOf } from "types/utils";

export const GitHubAppAuthorizationActions = {
  REVOKED: "revoked",
} as const;
export type GitHubAppAuthorizationAction = ValueOf<
  typeof GitHubAppAuthorizationActions
>;

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

/** GitHub's `repository.visibility`; `internal` is readable by the whole enterprise. */
export const RepositoryVisibilities = {
  PUBLIC: "public",
  PRIVATE: "private",
  INTERNAL: "internal",
} as const;
