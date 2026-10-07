import { z } from "zod/v4";
import {
  buildContextQuery,
  createBuiltInContextProviders,
  fetchContextSnippets,
} from "../context";
import { execFileAsync, MAX_BUFFER } from "./exec";
import { parsePrUrl, type PrLocator } from "./pr-url";
import type { ContextProvider } from "../context/types";
import { createGitHubRead, GitHubTransports } from "../context/trackers/github";
import { listReadableTrackers, type TrackerReads } from "../context/trackers";
import type { Result } from "types/utils";
import { attachPrStack, type OpenPullRequest } from "../pr-stack";
import type { FetchedPr, Log, PrMetadata } from "./types";

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
  headRefName: z.string().nullish(),
  headRepository: z.object({ name: z.string().min(1) }).nullish(),
  headRepositoryOwner: z.object({ login: z.string().min(1) }).nullish(),
  baseRefOid: z.string(),
  baseRefName: z.string().nullish(),
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
 * Parsed-`gh pr view` JSON → `PrMetadata` (exported for tests, the exec
 * wrapper below is just plumbing around this mapping).
 */
export function metadataFromView(raw: unknown): PrMetadata {
  const view = GhViewSchema.parse(raw);
  const ghState = view.state?.toUpperCase();
  const meta: PrMetadata = {
    title: view.title,
    body: view.body ?? "",
    url: view.url,
    sha: view.headRefOid,
    baseSha: view.baseRefOid,
    commitCount: view.commits?.length ?? 0,
    files: view.files ?? [],
  };

  const knownState =
    ghState === "OPEN" || ghState === "CLOSED" || ghState === "MERGED";
  if (knownState) {
    meta.state = ghState === "OPEN" ? "open" : "closed";
    meta.merged = ghState === "MERGED";
  }
  if (typeof view.isDraft === "boolean") {
    meta.draft = view.isDraft;
  }
  if (typeof view.headRefName === "string") {
    meta.headRef = view.headRefName;
  }
  if (typeof view.baseRefName === "string") {
    meta.baseRef = view.baseRefName;
  }
  const headOwner = view.headRepositoryOwner?.login;
  const headName = view.headRepository?.name;
  if (headOwner !== undefined && headName !== undefined) {
    meta.headRepo = { owner: headOwner, repo: headName };
  }

  return meta;
}

export const OPEN_PR_LIST_LIMIT = 100;

const GhOpenPullRequestSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRepository: z.object({ name: z.string().min(1) }).nullish(),
  headRepositoryOwner: z.object({ login: z.string().min(1) }).nullish(),
});

export interface GhOpenPullRequestParseError {
  readonly reason: "invalid-shape";
}

function mapGhOpenPullRequest(
  item: z.infer<typeof GhOpenPullRequestSchema>,
  listing: Pick<PrLocator, "owner" | "repo">,
): OpenPullRequest | undefined {
  const headOwner = item.headRepositoryOwner?.login;
  const headName = item.headRepository?.name;
  if (headOwner === undefined || headName === undefined) {
    return undefined;
  }
  return {
    number: item.number,
    title: item.title,
    headRef: item.headRefName,
    baseRef: item.baseRefName,
    headRepo: { owner: headOwner, repo: headName },
    baseRepo: { owner: listing.owner, repo: listing.repo },
  };
}

export function parseGhOpenPullRequests(
  raw: unknown,
  listing: Pick<PrLocator, "owner" | "repo">,
): Result<OpenPullRequest[], GhOpenPullRequestParseError> {
  const parsed = z.array(GhOpenPullRequestSchema).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { reason: "invalid-shape" } };
  }
  const value: OpenPullRequest[] = [];
  for (const item of parsed.data) {
    const mapped = mapGhOpenPullRequest(item, listing);
    if (mapped !== undefined) {
      value.push(mapped);
    }
  }
  return { ok: true, value };
}

async function fetchOpenPullRequests(
  loc: PrLocator,
): Promise<OpenPullRequest[] | undefined> {
  const { stdout } = await execFileAsync(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repoSlug(loc),
      "--state",
      "open",
      "--limit",
      String(OPEN_PR_LIST_LIMIT),
      "--json",
      "number,title,headRefName,baseRefName,headRepository,headRepositoryOwner",
    ],
    { maxBuffer: MAX_BUFFER },
  );
  const parsed = parseGhOpenPullRequests(JSON.parse(stdout), loc);
  if (!parsed.ok) {
    return undefined;
  }
  return parsed.value;
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
      "title,body,url,headRefOid,headRefName,headRepository,headRepositoryOwner,baseRefOid,baseRefName,commits,files,state,isDraft",
    ],
    { maxBuffer: MAX_BUFFER },
  );
  const meta = metadataFromView(JSON.parse(stdout));
  meta.baseRepo = { owner: loc.owner, repo: loc.repo };
  try {
    const open = await fetchOpenPullRequests(loc);
    if (open !== undefined) {
      attachPrStack(meta, loc.number, open);
    }
  } catch {
    // Listing is best-effort: a stack miss must not fail metadata.
  }
  return meta;
}

/** A commit-ish we will interpolate into a `gh api` path, restrict to hex SHAs. */
const COMMITISH = /^[0-9a-fA-F]{7,40}$/;

export function isCommitish(ref: string): boolean {
  return COMMITISH.test(ref);
}

/**
 * Artifacts require full SHAs because the browser joins comparison and delta heads by exact
 * equality. Abbreviated CLI input must resolve before storage; full SHAs avoid a network call.
 */
export async function resolveFullSha(
  loc: PrLocator,
  ref: string,
): Promise<string> {
  if (!isCommitish(ref)) {
    throw new Error(`expected a hex commit SHA (7-40 chars); got "${ref}"`);
  }
  if (ref.length === 40) {
    return ref.toLowerCase();
  }
  const { stdout } = await execFileAsync(
    "gh",
    ["api", `repos/${loc.owner}/${loc.repo}/commits/${ref}`, "--jq", ".sha"],
    { maxBuffer: MAX_BUFFER },
  );
  return stdout.trim();
}

/**
 * GitHub compare uses three-dot merge-base semantics, which can include noise after rebases.
 * A rebase-robust two-dot diff needs a local clone. Validate both SHAs before building API paths.
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
 * the description, run the context providers over it (best-effort). This is
 * the `gh` source, so the default ticket read is GitHub through `gh`.
 */
function createGhTrackerReads(): TrackerReads {
  const read = createGitHubRead(
    { env: {}, contextSources: [] },
    GitHubTransports.GH.create(),
  );
  return read.ok ? { github: read.value } : {};
}

export async function fetchPr(
  url: string,
  log: Log = () => {},
  providers: readonly ContextProvider[] = createBuiltInContextProviders(),
  reads: TrackerReads = createGhTrackerReads(),
): Promise<FetchedPr> {
  const locator = parsePrUrl(url);
  const [diff, meta] = await Promise.all([
    fetchPrDiff(locator),
    fetchPrMetadata(locator),
  ]);
  const query = buildContextQuery({
    title: meta.title,
    body: meta.body,
    branch: meta.headRef ?? "",
    repo: locator,
    trackers: [],
    readable: listReadableTrackers(reads),
  });
  const context = await fetchContextSnippets(query, providers, log, {
    reads,
  });
  return { locator, meta, diff, ...context };
}
