// Use GraphQL for collaborator display names and ALL affiliation for org/team grants.
// Nodes are Users, so App-bot filtering is unnecessary; failures use mapGraphqlError.
import type { Octokit } from "octokit";
import { z } from "zod";
import {
  GitHubApiErrorCodes,
  mapGraphqlError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result } from "../types";
import type { Mutable } from "types/utils";

export interface RepoCollaborator {
  readonly login: string;
  /** Display name; absent when the user never set one. */
  readonly name?: string;
  readonly avatarUrl: string;
}

export interface RepoCollaborators {
  readonly collaborators: readonly RepoCollaborator[];
  /** True when the page-cap was hit before exhausting the connection. */
  readonly hasMore: boolean;
}

export interface ListRepoCollaboratorsInput {
  readonly owner: string;
  readonly repo: string;
}

const wireCollaboratorSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
});

// `repository` is nullable (missing/inaccessible arrives as a null FIELD in a
// 2xx); `collaborators` is likewise nullable when the token lacks the
// permission to enumerate them. Connection nodes are a nullable list of
// nullable elements, per GitHub's schema-wide convention.
const collaboratorsResponseSchema = z.object({
  repository: z
    .object({
      collaborators: z
        .object({
          pageInfo: z.object({
            hasNextPage: z.boolean(),
            endCursor: z.string().nullable(),
          }),
          nodes: z.array(wireCollaboratorSchema.nullable()).nullable(),
        })
        .nullable(),
    })
    .nullable(),
});

// Variables only; nothing caller-supplied is ever interpolated.
const COLLABORATORS_QUERY = `
query RepoCollaborators($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    collaborators(first: 100, affiliation: ALL, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        login
        name
        avatarUrl
      }
    }
  }
}`;

/**
 * Safety cap on pagination: 3 pages × 100. A mention pool past 300 people is
 * noise, and an unbounded cursor loop would burn the shared installation rate
 * budget. Hitting the cap sets `hasMore` instead of failing.
 */
const MAX_COLLABORATOR_PAGES = 3;

const FETCH_CONTEXT = "list repo collaborators";

/** Sanitized not-found for a null repository/collaborators field. */
function resourceNotFoundError(): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.NOT_FOUND,
    message: `failed to ${FETCH_CONTEXT}: repository or collaborators not accessible`,
  };
}

/**
 * List everyone with access to the repo for the mention-autocomplete pool.
 * Intended to run on an installation-token octokit (shared rate budget,
 * cacheable per repo). Order is GitHub's wire order; ranking is the
 * consumer's concern.
 */
export async function listRepoCollaborators(
  octokit: Octokit,
  input: ListRepoCollaboratorsInput,
): Promise<Result<RepoCollaborators, GitHubApiError>> {
  const collaborators: RepoCollaborator[] = [];
  let cursor: string | null = null;
  let hasMore = false;

  for (let page = 0; page < MAX_COLLABORATOR_PAGES; page += 1) {
    let response: unknown;
    try {
      response = await octokit.graphql(COLLABORATORS_QUERY, {
        owner: input.owner,
        repo: input.repo,
        cursor,
      });
    } catch (error) {
      return { ok: false, error: mapGraphqlError(error, FETCH_CONTEXT) };
    }

    const parsed = collaboratorsResponseSchema.safeParse(response);
    if (!parsed.success) {
      return { ok: false, error: unexpectedResponseError(FETCH_CONTEXT) };
    }
    const connection = parsed.data.repository?.collaborators;
    if (connection === null || connection === undefined) {
      return { ok: false, error: resourceNotFoundError() };
    }

    for (const node of connection.nodes ?? []) {
      if (node === null) {
        continue;
      }
      const collaborator: Mutable<RepoCollaborator> = {
        login: node.login,
        avatarUrl: node.avatarUrl,
      };

      if (node.name !== null) collaborator.name = node.name;

      collaborators.push(collaborator);
    }

    hasMore = connection.pageInfo.hasNextPage;
    if (!hasMore || connection.pageInfo.endCursor === null) {
      break;
    }
    cursor = connection.pageInfo.endCursor;
  }

  return { ok: true, value: { collaborators, hasMore } };
}
