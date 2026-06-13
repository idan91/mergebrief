import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
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

/** Text fetched from a URL found in the PR description. Best-effort context. */
export interface LinkedContext {
  url: string;
  content: string;
}

export interface FetchedPr {
  locator: PrLocator;
  meta: PrMetadata;
  diff: string;
  links: LinkedContext[];
}

/** Minimal logger — structural so callers (CLI) can pass a tagged sink. */
type Log = (message: string) => void;

/** Cap fetched link bodies so a huge page can't blow up token cost. */
const MAX_LINK_CHARS = 20_000;
/** Bound how many links we chase per PR — cost and latency control. */
const MAX_LINKS = 5;
const LINK_TIMEOUT_MS = 10_000;

const URL_IN_TEXT = /https?:\/\/[^\s<>()\[\]"']+/g;

const PRIVATE_IPV4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./, // link-local incl. cloud metadata 169.254.169.254
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

function isPrivateAddr(addr: string): boolean {
  if (addr === "::1" || addr.startsWith("fc") || addr.startsWith("fd") || addr.startsWith("fe80")) {
    return true;
  }
  const v4 = addr.startsWith("::ffff:") ? addr.slice("::ffff:".length) : addr;
  return PRIVATE_IPV4.some((re) => re.test(v4));
}

/**
 * SSRF guard. The links come from an untrusted PR description, so before we
 * fetch one we reject non-http(s) schemes and any host that resolves to a
 * loopback / link-local / private address (cloud metadata, localhost dev
 * servers, internal hosts). DNS is resolved here; the fetch itself uses
 * `redirect: "manual"` so a public URL can't 3xx us into the private network.
 */
export async function isPublicUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local")) return false;
  try {
    const addr = isIP(host) ? host : (await lookup(host)).address;
    return !isPrivateAddr(addr);
  } catch {
    return false; // unresolvable → skip
  }
}

/** Distinct http(s) URLs in the PR description, trimmed of trailing punctuation. */
export function extractLinks(body: string): string[] {
  const seen = new Set<string>();
  for (const raw of body.match(URL_IN_TEXT) ?? []) {
    const url = raw.replace(/[.,;:]+$/, "");
    if (!seen.has(url)) seen.add(url);
  }
  return [...seen].slice(0, MAX_LINKS);
}

/**
 * Fetch the text behind each link in the PR description. Best-effort: any
 * failure (network, non-OK status, timeout, binary body) is logged and
 * skipped — a brief must still be producible from the diff alone.
 *
 * Future: richer extraction (HTML→text), auth'd sources, and private trackers
 * will likely move behind MCP servers / connectors. For now we take whatever a
 * plain GET returns, capped, and treat absence as normal.
 */
export async function fetchLinkedContext(
  body: string,
  log: Log = () => {},
): Promise<LinkedContext[]> {
  const urls = extractLinks(body);
  const results = await Promise.all(
    urls.map(async (url): Promise<LinkedContext | null> => {
      try {
        if (!(await isPublicUrl(url))) {
          log(`linked context: ${url} blocked (non-public or unresolvable), skipping`);
          return null;
        }
        // redirect: "manual" — do not let a public URL bounce us to an
        // internal one; a 3xx is simply skipped below.
        const res = await fetch(url, {
          signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
          redirect: "manual",
        });
        if (!res.ok) {
          log(`linked context: ${url} → HTTP ${res.status}, skipping`);
          return null;
        }
        const text = (await res.text()).slice(0, MAX_LINK_CHARS);
        log(`linked context: fetched ${url} (${text.length} chars)`);
        return { url, content: text };
      } catch (error) {
        log(
          `linked context: ${url} failed (${error instanceof Error ? error.message : String(error)}), skipping`,
        );
        return null;
      }
    }),
  );
  return results.filter((r): r is LinkedContext => r !== null);
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
