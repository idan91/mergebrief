// Repository lookups, id-based rather than by `owner/repo` so they survive
// renames. Generic over any authenticated `Octokit`; the authorization gate
// calls them with a viewer token. Failures are sanitized via
// `mapRequestError`.
import type { Octokit } from "octokit";
import type { InstallationId, RepoId } from "persistence";
import { z } from "zod/v4";
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
  /**
   * Whether the AUTHENTICATED viewer holds write (`push`) permission. Only
   * meaningful on a user-to-server read; GitHub scopes the `permissions`
   * block to the requesting identity; absent parses as `false`, never as a
   * capability grant.
   */
  readonly viewerCanPush: boolean;
}

const repositoryResponseSchema = z.object({
  full_name: z.string().min(1),
  private: z.boolean(),
  // `push` is tolerant-optional: a permissions block missing it degrades to
  // no-capability rather than failing the whole repo parse, which would turn a
  // capability-signal glitch into a full access denial.
  permissions: z.object({ push: z.boolean().optional() }).optional(),
});

/** Fetch a repository by its numeric id. */
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
        viewerCanPush: parsed.data.permissions?.push ?? false,
      },
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch repository") };
  }
}

/** Page size for the installation∩user listing, GitHub's maximum. */
const INSTALLATION_REPOSITORIES_PAGE_SIZE = 100;

const installationRepositoryItemSchema = z.object({
  id: repoIdSchema,
  full_name: z.string().min(1),
});

/**
 * The repos of `installationId` the AUTHENTICATED USER can also access, the
 * installation∩user-access intersection, fetched with the viewer's own token
 * and paginated to EXHAUSTION: this map is the list endpoint's authorization
 * universe, so an incomplete page would silently hide valid PRs. Numeric keys
 * are rename-proof; the verified names serve display.
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
      return {
        ok: false,
        error: unexpectedResponseError("list installation repositories"),
      };
    }
    const repos = new Map<RepoId, string>();
    for (const repo of parsed.data) {
      repos.set(repo.id, repo.full_name);
    }
    return { ok: true, value: repos };
  } catch (error) {
    return {
      ok: false,
      error: mapRequestError(error, "list installation repositories"),
    };
  }
}
