// Repo-collaborators primitive (BRIEF-94): the @mention candidate pool —
// everyone who can collaborate on the repo. GraphQL because REST's
// collaborators list carries no display name; `affiliation: ALL` is
// load-bearing — it includes org/team-granted members, the bulk of the
// intended pool, not just direct collaborators. Nodes are `User` objects
// (GitHub App bots cannot be repo collaborators), so no bot filtering is
// needed here. Failures funnel through `mapGraphqlError`.
import type { Octokit } from "octokit";
import { z } from "zod";
import {
  GitHubApiErrorCode,
  mapGraphqlError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result } from "../types";

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

/** Sanitized not-found for a null repository/collaborators field (expected failure). */
function resourceNotFoundError(): GitHubApiError {
  return {
    code: GitHubApiErrorCode.NOT_FOUND,
    message: `failed to ${FETCH_CONTEXT}: repository or collaborators not accessible`,
  };
}

/**
 * List everyone with access to the repo — direct collaborators plus
 * org/team-granted members — with login, display name, and avatar for the
 * mention-autocomplete pool. Intended to run on an installation-token
 * octokit (ADR 0027 posture: shared rate budget, cacheable per repo).
 * Order is GitHub's wire order; ranking is the consumer's concern.
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
      collaborators.push({
        login: node.login,
        ...(node.name === null ? {} : { name: node.name }),
        avatarUrl: node.avatarUrl,
      });
    }

    hasMore = connection.pageInfo.hasNextPage;
    if (!hasMore || connection.pageInfo.endCursor === null) {
      break;
    }
    cursor = connection.pageInfo.endCursor;
  }

  return { ok: true, value: { collaborators, hasMore } };
}
