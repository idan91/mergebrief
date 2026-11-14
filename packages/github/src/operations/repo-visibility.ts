import type { Octokit } from "octokit";
import { z } from "zod/v4";
import type { Result } from "types/utils";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import { RepositoryVisibilities, type RepositoryVisibility } from "../types";
import type { RepositoryRef } from "./pull-request/types";

const CONTEXT = "fetch repository visibility";

const repositoryVisibilitySchema = z.object({
  private: z.boolean(),
  visibility: z.enum(RepositoryVisibilities).optional(),
});

/** One repository's visibility; GitHub's answer without `visibility` reads it from `private`. */
export async function fetchRepositoryVisibility(
  octokit: Octokit,
  repo: RepositoryRef,
): Promise<Result<RepositoryVisibility, GitHubApiError>> {
  try {
    const response = await octokit.request("GET /repos/{owner}/{repo}", {
      owner: repo.owner,
      repo: repo.repo,
    });
    const body: unknown = response.data;
    const parsed = repositoryVisibilitySchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: unexpectedResponseError(CONTEXT) };
    }

    const { visibility } = parsed.data;
    if (visibility !== undefined) {
      return { ok: true, value: visibility };
    }
    const derived = parsed.data.private
      ? RepositoryVisibilities.PRIVATE
      : RepositoryVisibilities.PUBLIC;
    return { ok: true, value: derived };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, CONTEXT) };
  }
}
