// What GitHub offers when a reviewer types `@`, read on the reviewer's own
// token so nobody is suggested that GitHub would hide from them. Every
// caller-supplied string rides as a GraphQL variable; octokit reserves the
// name `query`, so the typed text rides as `search`.
import type { Octokit } from "octokit";
import type { Mutable, Result } from "types/utils";
import {
  GitHubApiErrorCodes,
  hasOnlyGraphqlErrorType,
  mapGraphqlError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../../errors";
import { GRAPHQL_NOT_FOUND, readPartialData } from "../partial-data";
import {
  MAX_MENTION_TARGETS,
  MENTION_SEARCH_PAGE_SIZE,
  RESOLVE_TARGETS_CONTEXT,
  SEARCH_TEAMS_CONTEXT,
  SEARCH_USERS_CONTEXT,
} from "./consts";
import {
  aliasedResponseSchema,
  mentionableTeamsResponseSchema,
  mentionableUsersResponseSchema,
  teamAliasSchema,
  userAliasSchema,
} from "./schemas";
import {
  MentionTargetKinds,
  type MentionTarget,
  type MentionableTeam,
  type MentionableUser,
  type ResolveMentionTargetsInput,
  type ResolvedMentionTargets,
  type SearchMentionableTeamsInput,
  type SearchMentionableUsersInput,
} from "./types";
import {
  buildTargetsQuery,
  buildTargetsVariables,
  getTargetAlias,
} from "./utils";

const MENTIONABLE_USERS_QUERY = `
query MentionableUsers($owner: String!, $repo: String!, $search: String!) {
  repository(owner: $owner, name: $repo) {
    mentionableUsers(first: ${MENTION_SEARCH_PAGE_SIZE}, query: $search) {
      nodes { login name avatarUrl }
    }
  }
}`;

const MENTIONABLE_TEAMS_QUERY = `
query MentionableTeams($org: String!, $search: String!) {
  organization(login: $org) {
    teams(first: ${MENTION_SEARCH_PAGE_SIZE}, query: $search) {
      nodes { combinedSlug name }
    }
  }
}`;

/** Users GitHub says can be mentioned in the repo, in GitHub's order. */
export async function searchMentionableUsers(
  octokit: Octokit,
  input: SearchMentionableUsersInput,
): Promise<Result<readonly MentionableUser[], GitHubApiError>> {
  let response: unknown;
  try {
    response = await octokit.graphql(MENTIONABLE_USERS_QUERY, {
      owner: input.owner,
      repo: input.repo,
      search: input.query,
    });
  } catch (error) {
    const requestError = mapGraphqlError(error, SEARCH_USERS_CONTEXT);
    return { ok: false, error: requestError };
  }

  const parsed = mentionableUsersResponseSchema.safeParse(response);
  if (!parsed.success) {
    const responseError = unexpectedResponseError(SEARCH_USERS_CONTEXT);
    return { ok: false, error: responseError };
  }
  const repository = parsed.data.repository;
  if (repository === null) {
    const repositoryHidden: GitHubApiError = {
      code: GitHubApiErrorCodes.NOT_FOUND,
      message: `failed to ${SEARCH_USERS_CONTEXT}: repository not accessible`,
    };
    return { ok: false, error: repositoryHidden };
  }

  const users: MentionableUser[] = [];
  for (const node of repository.mentionableUsers.nodes ?? []) {
    if (node === null) {
      continue;
    }
    const user: Mutable<MentionableUser> = {
      login: node.login,
      avatarUrl: node.avatarUrl,
    };
    if (node.name !== null) {
      user.name = node.name;
    }
    users.push(user);
  }
  return { ok: true, value: users };
}

/**
 * The org's teams GitHub shows the viewer. A login that is a person, or no
 * account, answers no teams; a token without the members permission is a
 * refusal the caller decides how to surface.
 */
export async function searchMentionableTeams(
  octokit: Octokit,
  input: SearchMentionableTeamsInput,
): Promise<Result<readonly MentionableTeam[], GitHubApiError>> {
  let response: unknown;
  try {
    response = await octokit.graphql(MENTIONABLE_TEAMS_QUERY, {
      org: input.org,
      search: input.query,
    });
  } catch (error) {
    if (hasOnlyGraphqlErrorType(error, GRAPHQL_NOT_FOUND)) {
      return { ok: true, value: [] };
    }
    const requestError = mapGraphqlError(error, SEARCH_TEAMS_CONTEXT);
    return { ok: false, error: requestError };
  }

  const parsed = mentionableTeamsResponseSchema.safeParse(response);
  if (!parsed.success) {
    const responseError = unexpectedResponseError(SEARCH_TEAMS_CONTEXT);
    return { ok: false, error: responseError };
  }
  const nodes = parsed.data.organization?.teams.nodes ?? [];
  const teams = nodes.filter((node) => node !== null);
  return { ok: true, value: teams };
}

function collectResolvedTargets(
  targets: readonly MentionTarget[],
  data: Record<string, unknown>,
  unanswered: ReadonlySet<string>,
): ResolvedMentionTargets | undefined {
  const users: string[] = [];
  const teams: `${string}/${string}`[] = [];
  for (const [index, target] of targets.entries()) {
    const alias = getTargetAlias(target, index);
    if (unanswered.has(alias)) {
      continue;
    }
    if (target.kind === MentionTargetKinds.USER) {
      const parsed = userAliasSchema.safeParse(data[alias]);
      if (!parsed.success) {
        return undefined;
      }
      if (parsed.data) {
        users.push(parsed.data.login);
      }
      continue;
    }
    const parsed = teamAliasSchema.safeParse(data[alias]);
    if (!parsed.success) {
      return undefined;
    }
    if (parsed.data?.team) {
      teams.push(parsed.data.team.combinedSlug);
    }
  }
  return { users, teams };
}

/**
 * Which of the targets GitHub shows the viewer, in one aliased call. An
 * alias GitHub refused for another reason is left out, so its mention stays
 * plain text. More targets than one call takes is a programmer error.
 */
export async function resolveMentionTargets(
  octokit: Octokit,
  input: ResolveMentionTargetsInput,
): Promise<Result<ResolvedMentionTargets, GitHubApiError>> {
  const { targets } = input;
  if (targets.length > MAX_MENTION_TARGETS) {
    throw new Error(
      `mention lookup takes at most ${MAX_MENTION_TARGETS} targets`,
    );
  }
  if (targets.length === 0) {
    return { ok: true, value: { users: [], teams: [] } };
  }

  let response: unknown;
  let unanswered: ReadonlySet<string> = new Set();
  try {
    response = await octokit.graphql(
      buildTargetsQuery(targets),
      buildTargetsVariables(targets),
    );
  } catch (error) {
    const partial = readPartialData(error);
    if (partial === undefined) {
      const requestError = mapGraphqlError(error, RESOLVE_TARGETS_CONTEXT);
      return { ok: false, error: requestError };
    }
    response = partial.data;
    unanswered = partial.unanswered;
  }

  const parsed = aliasedResponseSchema.safeParse(response);
  const resolved = parsed.success
    ? collectResolvedTargets(targets, parsed.data, unanswered)
    : undefined;
  if (resolved === undefined) {
    const responseError = unexpectedResponseError(RESOLVE_TARGETS_CONTEXT);
    return { ok: false, error: responseError };
  }
  return { ok: true, value: resolved };
}
