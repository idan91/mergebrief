// Repository lookup by numeric id (BRIEF-2 stage 2). Id-based (`GET
// /repositories/{id}`) rather than by `owner/repo` so it survives renames —
// this is the primitive the stage-7 authorization gate calls with a viewer
// token, but here it is generic over any authenticated `Octokit`. Failures are
// sanitized via `mapRequestError`.
import type { Octokit } from "octokit";
import type { RepoId } from "persistence";
import { z } from "zod";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "./errors";
import type { Result } from "./types";

export interface RepositoryInfo {
  readonly repoId: RepoId;
  readonly fullName: string;
  readonly private: boolean;
}

const repositoryResponseSchema = z.object({
  full_name: z.string().min(1),
  private: z.boolean(),
});

/**
 * Fetch a repository by its numeric id. Returns the id (echoed from the
 * caller's branded `repoId`), full name, and visibility. A non-2xx response
 * (404/403/…) becomes a sanitized `GitHubApiError` carrying only status + a
 * static message.
 */
export async function fetchRepositoryById(
  octokit: Octokit,
  repoId: RepoId,
): Promise<Result<RepositoryInfo, GitHubApiError>> {
  try {
    const response = await octokit.request("GET /repositories/{id}", {
      id: Number(repoId),
    });
    const body: unknown = response.data;
    const parsed = repositoryResponseSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: unexpectedResponseError("fetch repository") };
    }
    return {
      ok: true,
      value: {
        repoId,
        fullName: parsed.data.full_name,
        private: parsed.data.private,
      },
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch repository") };
  }
}
