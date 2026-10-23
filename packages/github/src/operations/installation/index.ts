// The reads that confirm an installation event before anything is purged.
// Both run inside GitHub's 10s webhook budget: no retry, and one deadline that
// also bounds the token mint, so a slow GitHub answers unavailable, never gone.
import type { Octokit } from "octokit";
import type { InstallationId, RepoId } from "persistence";
import type { Result } from "types/utils";
import { z } from "zod/v4";
import type { AppClient } from "../../auth/app";
import {
  GitHubApiErrorCodes,
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../../errors";
import { repoIdSchema } from "../../ids";
import { INSTALLATION_REPOSITORIES_PAGE_SIZE } from "../repo";
import { InstallationPresences, type InstallationPresence } from "./types";

/** Two reads in a row still leave room inside GitHub's 10s delivery timeout. */
export const CONFIRMATION_READ_TIMEOUT_MS = 4_000;

/** Reject once the deadline passes, whether or not the read honoured the signal. */
async function runWithinDeadline<Value>(
  read: (signal: AbortSignal) => Promise<Value>,
): Promise<Value> {
  const signal = AbortSignal.timeout(CONFIRMATION_READ_TIMEOUT_MS);
  const deadline = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
  return Promise.race([read(signal), deadline]);
}

/** On the App's own JWT: a deleted installation cannot mint a token. */
export async function readInstallationPresence(
  app: AppClient,
  installationId: InstallationId,
): Promise<Result<InstallationPresence, GitHubApiError>> {
  try {
    await runWithinDeadline((signal) =>
      app.octokit.request("GET /app/installations/{installation_id}", {
        installation_id: Number(installationId),
        request: { retries: 0, signal },
      }),
    );
    return { ok: true, value: InstallationPresences.PRESENT };
  } catch (error) {
    const mapped = mapRequestError(error, "read installation presence");
    if (mapped.code === GitHubApiErrorCodes.NOT_FOUND) {
      return { ok: true, value: InstallationPresences.GONE };
    }
    return { ok: false, error: mapped };
  }
}

const repoIdPageSchema = z.object({
  repositories: z.array(z.object({ id: repoIdSchema })),
});

/** octokit's `paginate` drops per-request options, so the pages loop by hand. */
async function collectRepoIds(
  octokit: Octokit,
  signal: AbortSignal,
): Promise<Set<RepoId> | undefined> {
  const repoIds = new Set<RepoId>();
  for (let page = 1; ; page += 1) {
    const response = await octokit.request("GET /installation/repositories", {
      per_page: INSTALLATION_REPOSITORIES_PAGE_SIZE,
      page,
      request: { retries: 0, signal },
    });
    const parsed = repoIdPageSchema.safeParse(response.data);
    if (!parsed.success) {
      return undefined;
    }
    for (const repo of parsed.data.repositories) {
      repoIds.add(repo.id);
    }
    if (parsed.data.repositories.length < INSTALLATION_REPOSITORIES_PAGE_SIZE) {
      return repoIds;
    }
  }
}

/**
 * Every repository id the installation holds, on its own token, read to the
 * last page: a missing page would read a held repository as removed.
 */
export async function listInstallationRepoIds(
  octokit: Octokit,
): Promise<Result<ReadonlySet<RepoId>, GitHubApiError>> {
  try {
    const repoIds = await runWithinDeadline((signal) =>
      collectRepoIds(octokit, signal),
    );
    if (repoIds === undefined) {
      return {
        ok: false,
        error: unexpectedResponseError("list installation repo ids"),
      };
    }
    return { ok: true, value: repoIds };
  } catch (error) {
    return {
      ok: false,
      error: mapRequestError(error, "list installation repo ids"),
    };
  }
}
