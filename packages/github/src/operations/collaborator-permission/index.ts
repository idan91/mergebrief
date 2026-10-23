// Read while a webhook delivery waits: no retry, and one deadline that also
// bounds the lazy token mint, inside GitHub's 10s delivery budget.
import type { Octokit } from "octokit";
import type { Result } from "types/utils";
import { z } from "zod/v4";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../../errors";
import { CONFIRMATION_READ_TIMEOUT_MS, runWithinDeadline } from "../deadline";
import type { RepositoryRef } from "../pull-request/types";
import { CollaboratorPermissions, type CollaboratorPermission } from "./types";

const CONTEXT = "read collaborator permission";

const permissionResponseSchema = z.object({
  permission: z.enum(CollaboratorPermissions),
});

export interface ReadCollaboratorPermissionInput extends RepositoryRef {
  readonly login: string;
}

/** The user's effective permission on the repository, org and team grants included. */
export async function readCollaboratorPermission(
  octokit: Octokit,
  input: ReadCollaboratorPermissionInput,
): Promise<Result<CollaboratorPermission, GitHubApiError>> {
  try {
    const response = await runWithinDeadline(
      (signal) =>
        octokit.request(
          "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
          {
            owner: input.owner,
            repo: input.repo,
            username: input.login,
            request: { retries: 0, signal },
          },
        ),
      CONFIRMATION_READ_TIMEOUT_MS,
    );
    const parsed = permissionResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      return { ok: false, error: unexpectedResponseError(CONTEXT) };
    }
    return { ok: true, value: parsed.data.permission };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, CONTEXT) };
  }
}
