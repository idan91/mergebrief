import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod/v4";
import { fetchLinkedContext } from "./linked-context";
import type { FetchedPr, Log, PrLocator, PrMetadata } from "./types";

/** Folder-internal exec plumbing — shared with `comments.ts`, not on the barrel. */
export const execFileAsync = promisify(execFile);

/** 64 MiB — large PRs can produce big diffs; default execFile buffer is 1 MiB. */
export const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * GitHub owner/repo segment grammar: alphanumerics, hyphen, underscore, dot.
 * Validating before we ever hand a value to `gh` keeps untrusted URL input
 * out of the argument list (defense in depth — we use execFile, not a shell,
 * so there is no shell to inject into either way).
 */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

const PR_URL = new RegExp(
  String.raw`^https?://github\.com/([^/]+)/([^/]+)/pull/(\d+)(?:[/?#].*)?$`,
);

export function parsePrUrl(url: string): PrLocator {
  const match = PR_URL.exec(url.trim());
  if (!match) {
    throw new Error(
      `Not a GitHub PR URL: ${url}\nExpected https://github.com/<owner>/<repo>/pull/<number>`,
    );
  }
  const [, owner, repo, num] = match;
  if (!owner || !repo || !num || !SEGMENT.test(owner) || !SEGMENT.test(repo)) {
    throw new Error(`Malformed owner/repo in PR URL: ${url}`);
  }
  return { owner, repo, number: Number(num) };
}

/** Folder-internal (also used by `comments.ts`); not on the barrel. */
export function repoSlug(loc: PrLocator): string {
  return `${loc.owner}/${loc.repo}`;
}

export async function fetchPrDiff(loc: PrLocator): Promise<string> {
  const { stdout } = await execFileAsync(
    "gh",
    ["pr", "diff", String(loc.number), "--repo", repoSlug(loc)],
    { maxBuffer: MAX_BUFFER },
  );
  return stdout;
}

/** Shape of `gh pr view --json …` output we rely on. Validated at the boundary. */
const GhViewSchema = z.object({
  title: z.string(),
  body: z.string().nullish(),
  url: z.string(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  // `commits` carries one entry per commit in the PR; we only need the count.
  commits: z.array(z.unknown()).nullish(),
  files: z
    .array(
      z.object({
        path: z.string(),
        additions: z.number(),
        deletions: z.number(),
      }),
    )
    .nullish(),
  // gh's state vocabulary folds merged into state (`MERGED`), unlike the REST
  // shape. Unknown values fail open: the optional lifecycle fields are omitted.
  state: z.string().nullish(),
  isDraft: z.boolean().nullish(),
});

/**
 * Parsed-`gh pr view` JSON → `PrMetadata` (exported for tests — the exec
 * wrapper below is just plumbing around this mapping).
 */
export function metadataFromView(raw: unknown): PrMetadata {
  const view = GhViewSchema.parse(raw);
  const ghState = view.state?.toUpperCase();
  const lifecycle =
    ghState === "OPEN" || ghState === "CLOSED" || ghState === "MERGED"
      ? {
          state: ghState === "OPEN" ? ("open" as const) : ("closed" as const),
          merged: ghState === "MERGED",
        }
      : {};
  return {
    title: view.title,
    body: view.body ?? "",
    url: view.url,
    sha: view.headRefOid,
    baseSha: view.baseRefOid,
    commitCount: view.commits?.length ?? 0,
    files: view.files ?? [],
    ...lifecycle,
    ...(typeof view.isDraft === "boolean" ? { draft: view.isDraft } : {}),
  };
}

export async function fetchPrMetadata(loc: PrLocator): Promise<PrMetadata> {
  const { stdout } = await execFileAsync(
    "gh",
    [
      "pr",
      "view",
      String(loc.number),
      "--repo",
      repoSlug(loc),
      "--json",
      "title,body,url,headRefOid,baseRefOid,commits,files,state,isDraft",
    ],
    { maxBuffer: MAX_BUFFER },
  );
  return metadataFromView(JSON.parse(stdout));
}

/** A commit-ish we will interpolate into a `gh api` path — restrict to hex SHAs. */
const COMMITISH = /^[0-9a-fA-F]{7,40}$/;

export function isCommitish(ref: string): boolean {
  return COMMITISH.test(ref);
}

/**
 * Resolve a possibly-abbreviated commit SHA to the full 40-char SHA via the
 * commits API. Artifacts must be keyed by full SHAs: the FE joins comparison
 * marks and Delta artifacts onto brief heads by exact SHA equality, so a
 * short SHA passed on the CLI would produce artifacts that silently never
 * match. Already-full SHAs return as-is without a network call.
 */
export async function resolveFullSha(
  loc: PrLocator,
  ref: string,
): Promise<string> {
  if (!isCommitish(ref)) {
    throw new Error(`expected a hex commit SHA (7-40 chars); got "${ref}"`);
  }
  if (ref.length === 40) return ref.toLowerCase();
  const { stdout } = await execFileAsync(
    "gh",
    ["api", `repos/${loc.owner}/${loc.repo}/commits/${ref}`, "--jq", ".sha"],
    { maxBuffer: MAX_BUFFER },
  );
  return stdout.trim();
}

/**
 * Incremental unified diff between two commits of a PR's repo, via the GitHub
 * compare API (`base...head`). Three-dot (merge-base) semantics: identical to a
 * true tree diff when head descends from baseline, but after a rebase/force-push
 * it can include merge-base noise — the rebase-robust two-dot form needs a local
 * clone. base/head are validated as hex SHAs before reaching the api path.
 */
export async function fetchCompareDiff(
  loc: PrLocator,
  baseSha: string,
  headSha: string,
): Promise<string> {
  if (!isCommitish(baseSha) || !isCommitish(headSha)) {
    throw new Error(
      `base/head must be hex commit SHAs (7–40 chars); got "${baseSha}" / "${headSha}"`,
    );
  }
  const { stdout } = await execFileAsync(
    "gh",
    [
      "api",
      `repos/${loc.owner}/${loc.repo}/compare/${baseSha}...${headSha}`,
      "-H",
      "Accept: application/vnd.github.diff",
    ],
    { maxBuffer: MAX_BUFFER },
  );
  return stdout;
}

/**
 * Number of commits in a PR's `base...head` span, via the compare API's
 * `total_commits`. Used for a brief's commit range when an explicit range is
 * given (the default whole-PR case reads the count from `gh pr view`). base/head
 * validated as hex SHAs before they reach the api path (defense in depth).
 */
export async function fetchCompareCommitCount(
  loc: PrLocator,
  baseSha: string,
  headSha: string,
): Promise<number> {
  if (!isCommitish(baseSha) || !isCommitish(headSha)) {
    throw new Error(
      `base/head must be hex commit SHAs (7–40 chars); got "${baseSha}" / "${headSha}"`,
    );
  }
  const { stdout } = await execFileAsync(
    "gh",
    [
      "api",
      `repos/${loc.owner}/${loc.repo}/compare/${baseSha}...${headSha}`,
      "--jq",
      ".total_commits",
    ],
    { maxBuffer: MAX_BUFFER },
  );
  const n = Number(stdout.trim());
  if (!Number.isInteger(n)) {
    throw new Error(`could not read total_commits for ${baseSha}...${headSha}`);
  }
  return n;
}

/**
 * Parse a PR URL, then fetch its diff and metadata in parallel. Once we have
 * the description, chase any links in it for extra context (best-effort).
 */
export async function fetchPr(
  url: string,
  log: Log = () => {},
): Promise<FetchedPr> {
  const locator = parsePrUrl(url);
  const [diff, meta] = await Promise.all([
    fetchPrDiff(locator),
    fetchPrMetadata(locator),
  ]);
  const links = await fetchLinkedContext(meta.body, log);
  return { locator, meta, diff, links };
}
