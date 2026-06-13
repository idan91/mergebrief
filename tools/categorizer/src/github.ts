import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod/v4";

const execFileAsync = promisify(execFile);

/** 64 MiB — large PRs can produce big diffs; default execFile buffer is 1 MiB. */
const MAX_BUFFER = 64 * 1024 * 1024;

export interface PrLocator {
  owner: string;
  repo: string;
  number: number;
}

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface PrMetadata {
  title: string;
  body: string;
  url: string;
  sha: string;
  files: PrFile[];
}

export interface FetchedPr {
  locator: PrLocator;
  meta: PrMetadata;
  diff: string;
}

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

function repoSlug(loc: PrLocator): string {
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
  files: z
    .array(
      z.object({
        path: z.string(),
        additions: z.number(),
        deletions: z.number(),
      }),
    )
    .nullish(),
});

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
      "title,body,url,headRefOid,files",
    ],
    { maxBuffer: MAX_BUFFER },
  );
  const view = GhViewSchema.parse(JSON.parse(stdout));
  return {
    title: view.title,
    body: view.body ?? "",
    url: view.url,
    sha: view.headRefOid,
    files: view.files ?? [],
  };
}

/** Parse a PR URL, then fetch its diff and metadata in parallel. */
export async function fetchPr(url: string): Promise<FetchedPr> {
  const locator = parsePrUrl(url);
  const [diff, meta] = await Promise.all([
    fetchPrDiff(locator),
    fetchPrMetadata(locator),
  ]);
  return { locator, meta, diff };
}
