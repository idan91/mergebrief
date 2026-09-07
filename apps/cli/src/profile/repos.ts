// Repo addressing: the per-profile disk cache of `GET /api/repos`
// (`<cacheDir>/<profile>/repos.json`, NO TTL — XDG cache = safe-to-delete
// signal) and the self-healing resolution used by every PR-addressed command:
//   cache miss            → refresh once, retry
//   slug not in the cache → refresh once, retry (rename self-heal)
//   `--refresh`           → bypass the cache outright
// Not-found AFTER a refresh is the DISTINCT not-found exit with an honest
// error naming the profile — never a guess, never a prompt.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ApiClient } from "../client";
import { CliError, ExitCodes } from "../exit";

const reposBodySchema = z.object({
  repos: z.array(z.object({ repoId: z.string(), fullName: z.string() })),
});
export type ReposBody = z.infer<typeof reposBodySchema>;

export interface RepoCacheDeps {
  readonly client: ApiClient;
  readonly cacheDir: string;
  readonly profileName: string;
}

function cachePath(deps: RepoCacheDeps): string {
  return join(deps.cacheDir, deps.profileName, "repos.json");
}

/** A cache read keeps the RAW disk bytes alongside the parsed shape — the
 * verbatim-passthrough promise holds on the cached path too. */
function readCache(
  deps: RepoCacheDeps,
): { body: ReposBody; bodyText: string } | undefined {
  let raw: string;
  try {
    raw = readFileSync(cachePath(deps), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = reposBodySchema.safeParse(JSON.parse(raw));
    return parsed.success ? { body: parsed.data, bodyText: raw } : undefined;
  } catch {
    // A corrupt cache is a miss — it self-heals on the next fetch.
    return undefined;
  }
}

/**
 * Fetch `GET /api/repos` and persist the VERBATIM body to the profile cache.
 * Returns both the parsed shape (for resolution) and the raw text (for
 * verbatim passthrough output).
 */
export async function refreshRepos(
  deps: RepoCacheDeps,
): Promise<{ body: ReposBody; bodyText: string }> {
  const response = await deps.client.request({ path: "/api/repos" });
  const parsed = reposBodySchema.safeParse(JSON.parse(response.bodyText));
  if (!parsed.success) {
    throw new CliError(
      ExitCodes.GENERIC,
      "the server's /api/repos response did not match the documented shape (version skew? check `mergebrief auth status`)",
    );
  }
  mkdirSync(join(deps.cacheDir, deps.profileName), { recursive: true });
  writeFileSync(cachePath(deps), response.bodyText);
  return { body: parsed.data, bodyText: response.bodyText };
}

/** The `repos` command's read: cache unless `--refresh`/missing. */
export async function loadRepos(
  deps: RepoCacheDeps,
  options: { readonly refresh: boolean },
): Promise<{ body: ReposBody; bodyText: string }> {
  if (!options.refresh) {
    const cached = readCache(deps);
    if (cached !== undefined) {
      return cached;
    }
  }
  return refreshRepos(deps);
}

/**
 * Resolve `owner/name` → repoId with the self-healing triggers.
 */
export async function resolveRepoId(
  deps: RepoCacheDeps,
  fullName: string,
): Promise<string> {
  const cached = readCache(deps);
  const hit = cached?.body.repos.find((repo) => repo.fullName === fullName);
  if (hit !== undefined) {
    return hit.repoId;
  }
  // Miss OR slug mismatch → refresh ONCE and retry.
  const { body } = await refreshRepos(deps);
  const fresh = body.repos.find((repo) => repo.fullName === fullName);
  if (fresh === undefined) {
    throw new CliError(
      ExitCodes.NOT_FOUND,
      `${fullName} is not visible to profile "${deps.profileName}" — not in its installation, or your access changed (try --refresh, -R owner/name, or another profile)`,
    );
  }
  return fresh.repoId;
}
