// Wire-shaped fixtures for the mention reads. `name` is nullable on users,
// as on every GraphQL `User`.

export interface GqlMentionableUser {
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string;
}

export interface GqlMentionableUserOptions {
  readonly login?: string;
  readonly name?: string | null;
}

export function makeGqlMentionableUser(
  options: GqlMentionableUserOptions = {},
): GqlMentionableUser {
  const login = options.login ?? "alice";
  const name = options.name === undefined ? "Alice Example" : options.name;
  const avatarUrl = `https://avatars.example/${login}.png`;
  return { login, name, avatarUrl };
}

export interface MentionableUsersWire {
  readonly repository: {
    readonly mentionableUsers: {
      readonly nodes: ReadonlyArray<GqlMentionableUser | null> | null;
    };
  } | null;
}

export function makeMentionableUsersResponse(
  nodes: ReadonlyArray<GqlMentionableUser | null> | null,
): MentionableUsersWire {
  return { repository: { mentionableUsers: { nodes } } };
}

export interface GqlMentionableTeam {
  readonly combinedSlug: string;
  readonly name: string;
}

export function makeGqlMentionableTeam(
  combinedSlug: string,
  name: string,
): GqlMentionableTeam {
  return { combinedSlug, name };
}

export interface MentionableTeamsWire {
  readonly organization: {
    readonly teams: {
      readonly nodes: ReadonlyArray<GqlMentionableTeam | null> | null;
    };
  };
}

export function makeMentionableTeamsResponse(
  nodes: ReadonlyArray<GqlMentionableTeam | null> | null,
): MentionableTeamsWire {
  return { organization: { teams: { nodes } } };
}

/** The throw octokit raises when some aliases errored: data rides along. */
export function makePartialAliasError(
  data: Record<string, unknown>,
  errors: ReadonlyArray<{ type: string; path: readonly string[] }>,
): Error {
  const error = new Error("Request failed due to following response errors");
  error.name = "GraphqlResponseError";
  return Object.assign(error, { data, errors });
}
