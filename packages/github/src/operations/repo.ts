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
import type { Result } from "types/utils";

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
  /** Same block, `admin`: the delete gate; absent parses as `false`. */
  readonly viewerIsAdmin: boolean;
}

// Both bits are tolerant-optional: a permissions block missing one degrades
// to no-capability rather than failing the whole repo parse, which would
// turn a capability-signal glitch into a full access denial.
const permissionsSchema = z
  .object({ push: z.boolean().optional(), admin: z.boolean().optional() })
  .optional();

const repositoryResponseSchema = z.object({
  full_name: z.string().min(1),
  private: z.boolean(),
  permissions: permissionsSchema,
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
        viewerIsAdmin: parsed.data.permissions?.admin ?? false,
      },
    };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "fetch repository") };
  }
}

/** Page size for both installation listings, GitHub's maximum. */
export const INSTALLATION_REPOSITORIES_PAGE_SIZE = 100;

const installationRepositoryItemSchema = z.object({
  id: repoIdSchema,
  full_name: z.string().min(1),
  permissions: permissionsSchema,
});

/** One repository of the installation∩user listing. */
export interface InstallationRepository {
  /** GitHub-verified `owner/name`. */
  readonly fullName: string;
  /** The viewer's `permissions.admin` on this repository; absent is `false`. */
  readonly viewerIsAdmin: boolean;
  /** The viewer's `permissions.push` on this repository; absent is `false`. */
  readonly viewerCanPush: boolean;
}

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
): Promise<
  Result<ReadonlyMap<RepoId, InstallationRepository>, GitHubApiError>
> {
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
    const repos = new Map<RepoId, InstallationRepository>();
    for (const repo of parsed.data) {
      repos.set(repo.id, {
        fullName: repo.full_name,
        viewerIsAdmin: repo.permissions?.admin ?? false,
        viewerCanPush: repo.permissions?.push ?? false,
      });
    }
    return { ok: true, value: repos };
  } catch (error) {
    return {
      ok: false,
      error: mapRequestError(error, "list installation repositories"),
    };
  }
}
