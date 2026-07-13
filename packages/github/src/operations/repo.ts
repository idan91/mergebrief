// Repository lookups (BRIEF-2 stage 2; BRIEF-19 PR 1.2). Id-based (`GET
// /repositories/{id}`) rather than by `owner/repo` so it survives renames —
// this is the primitive the stage-7 authorization gate calls with a viewer
// token, but here it is generic over any authenticated `Octokit`. The
// installation∩user intersection (`GET /user/installations/{id}/repositories`)
// backs the BRIEF-19 list endpoint's allowed-repo set. Failures are sanitized
// via `mapRequestError`.
import type { Octokit } from "octokit";
import type { InstallationId, RepoId } from "persistence";
import { z } from "zod";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import { repoIdSchema } from "../ids";
import type { Result } from "../types";

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

/** Page size for the installation∩user listing — GitHub's maximum. */
const INSTALLATION_REPOSITORIES_PAGE_SIZE = 100;

const installationRepositoryItemSchema = z.object({
  id: repoIdSchema,
  full_name: z.string().min(1),
});

/**
 * The repos of `installationId` that the AUTHENTICATED USER can also access —
 * the exact installation∩user-access intersection (ADR 0016 #5b), fetched with
 * the viewer's own token via `GET /user/installations/{installation_id}/
 * repositories`, paginated to EXHAUSTION: this map is the list endpoint's
 * authorization universe, so an incomplete page would silently hide valid PRs
 * (a correctness bug, not a fail-closed posture). Returns numeric-id →
 * GitHub-verified `owner/name` (numeric keys are rename-proof; the verified
 * names serve display, mirroring the per-repo gate's `repoFullName`). A
 * non-2xx (including the 401 that triggers the caller's token refresh)
 * becomes a sanitized `GitHubApiError`.
 */
export async function listInstallationRepositoriesForUser(
  octokit: Octokit,
  installationId: InstallationId,
): Promise<Result<ReadonlyMap<RepoId, string>, GitHubApiError>> {
  try {
    // `paginate` follows the Link header until exhaustion and normalizes the
    // `repositories`-wrapped payload to a flat item array.
    const items: unknown = await octokit.paginate(
      "GET /user/installations/{installation_id}/repositories",
      {
        installation_id: Number(installationId),
        per_page: INSTALLATION_REPOSITORIES_PAGE_SIZE,
      },
    );
    const parsed = z.array(installationRepositoryItemSchema).safeParse(items);
    if (!parsed.success) {
      return { ok: false, error: unexpectedResponseError("list installation repositories") };
    }
    const repos = new Map<RepoId, string>();
    for (const repo of parsed.data) {
      repos.set(repo.id, repo.full_name);
    }
    return { ok: true, value: repos };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "list installation repositories") };
  }
}
