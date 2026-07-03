import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isIP, type LookupFunction } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { z } from "zod/v4";
import { type ReviewComment } from "./types.js";

export type { ReviewComment };

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
  /** PR base commit SHA — the start of the whole-PR commit range (ADR 0012). */
  baseSha: string;
  /** Number of commits in the PR at this head. */
  commitCount: number;
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

const URL_IN_TEXT = /https?:\/\/[^\s<>()[\]"']+/g;

const PRIVATE_IPV4 = [
  /^0\./, // "this network" / unspecified
  /^10\./,
  /^127\./,
  /^169\.254\./, // link-local incl. cloud metadata 169.254.169.254
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

function isPrivateAddr(addr: string): boolean {
  const a = addr.toLowerCase();
  if (
    a === "::" || // unspecified
    a === "::1" || // loopback
    a.startsWith("fc") || // unique-local fc00::/7
    a.startsWith("fd") ||
    a.startsWith("fe80") || // link-local
    a.startsWith("64:ff9b:") // NAT64 → embeds an IPv4 we can't see here
  ) {
    return true;
  }
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) collapses to the v4 ranges below.
  const v4 = a.startsWith("::ffff:") ? a.slice("::ffff:".length) : a;
  return PRIVATE_IPV4.some((re) => re.test(v4));
}

/**
 * Synchronous pre-filter for a candidate link. Rejects non-http(s) schemes,
 * embedded credentials (userinfo — almost never a real public reference, and a
 * credential-leak hazard), localhost/`.local`, and literal private IPs. This is
 * a fast gate only; the authoritative SSRF defense is `validatingLookup`, which
 * checks the address at *connect* time and so is immune to DNS-rebinding TOCTOU.
 */
export function isPublicUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username !== "" || url.password !== "") return false;
  const host = url.hostname.replace(/^\[|\]$/g, ""); // unwrap [::1]
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (isIP(host) && isPrivateAddr(host)) return false;
  return true;
}

/** A `dns.lookup`-shaped resolver that rejects any private resolved address. */
const validatingLookup: LookupFunction = (hostname, _options, callback) => {
  // `{ all: true }` so a host returning several A/AAAA records can't sneak a
  // private one past us. We connect to exactly the address we validate.
  dnsLookup(hostname, { all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    const blocked = addresses.find((a) => isPrivateAddr(a.address));
    if (blocked) {
      callback(
        Object.assign(new Error(`blocked private address ${blocked.address}`), {
          code: "ESSRFBLOCKED",
        }),
        "",
        0,
      );
      return;
    }
    const first = addresses[0];
    if (!first) return callback(new Error("no address"), "", 0);
    callback(null, first.address, first.family);
  });
};

/** Strip credentials from a URL for safe logging/display; redact if unparseable. */
function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "<unparseable-url>";
  }
}

type FetchTextResult = { text: string } | { error: string };

/**
 * GET a URL's body as text, validating the connection address at connect time
 * (closes DNS-rebinding TOCTOU) and not following redirects (a 3xx is treated
 * as a skip, so a public URL can't bounce us to an internal one). Body is
 * capped at MAX_LINK_CHARS.
 */
function fetchText(rawUrl: string): Promise<FetchTextResult> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      resolve({ error: "malformed URL" });
      return;
    }
    const get = url.protocol === "https:" ? httpsGet : httpGet;
    const req = get(
      rawUrl,
      { lookup: validatingLookup, timeout: LINK_TIMEOUT_MS },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume(); // drain & discard; covers 3xx (we do not follow)
          resolve({ error: `HTTP ${status}` });
          return;
        }
        res.setEncoding("utf8");
        let body = "";
        res.on("data", (chunk: string) => {
          if (body.length >= MAX_LINK_CHARS) return;
          body += chunk;
          if (body.length >= MAX_LINK_CHARS) {
            body = body.slice(0, MAX_LINK_CHARS);
            req.destroy(); // stop reading once we have enough
          }
        });
        res.on("end", () => resolve({ text: body }));
        res.on("error", (e) => resolve({ error: e.message }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e: NodeJS.ErrnoException) =>
      resolve({ error: e.code === "ESSRFBLOCKED" ? "private address" : e.message }),
    );
  });
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
 * failure (network, non-OK status, timeout, binary body, SSRF block) is logged
 * and skipped — a brief must still be producible from the diff alone. URLs are
 * credential-stripped before they reach a log line or the stored context.
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
      const shown = displayUrl(url);
      if (!isPublicUrl(url)) {
        log(`linked context: ${shown} blocked (non-public or credentialed), skipping`);
        return null;
      }
      const result = await fetchText(url);
      if ("error" in result) {
        log(`linked context: ${shown} failed (${result.error}), skipping`);
        return null;
      }
      log(`linked context: fetched ${shown} (${result.text.length} chars)`);
      return { url: shown, content: result.text };
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
      "title,body,url,headRefOid,baseRefOid,commits,files",
    ],
    { maxBuffer: MAX_BUFFER },
  );
  const view = GhViewSchema.parse(JSON.parse(stdout));
  return {
    title: view.title,
    body: view.body ?? "",
    url: view.url,
    sha: view.headRefOid,
    baseSha: view.baseRefOid,
    commitCount: view.commits?.length ?? 0,
    files: view.files ?? [],
  };
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
 * compare API (`base...head`). NOTE: the compare endpoint is **three-dot
 * (merge-base) semantics** — identical to a true tree diff when head descends
 * from baseline (the normal follow-up case), but after a rebase/force-push it
 * can include merge-base noise. The rebase-robust two-dot (`git diff base head`,
 * ADR 0006's intent) needs a local clone — a known CLI limitation to revisit.
 * base/head are validated as hex SHAs before they reach the api path (defense
 * in depth — execFile, no shell).
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

const MAX_COMMENTS = 100;
const MAX_COMMENT_CHARS = 2_000;

const GhCommentSchema = z.object({
  id: z.number(),
  path: z.string().nullish(),
  start_line: z.number().nullish(),
  line: z.number().nullish(),
  original_start_line: z.number().nullish(),
  original_line: z.number().nullish(),
  // "line" for a line/range comment, "file" for a file-level comment.
  subject_type: z.string().nullish(),
  body: z.string().nullish(),
  user: z.object({ login: z.string() }).nullish(),
  in_reply_to_id: z.number().nullish(),
});

/**
 * GitHub marks a *line* comment outdated by nulling its `line` — the line it
 * anchored to is no longer part of the diff at the PR's current head (the
 * `original_line` is retained). This is read, not recomputed (ADR 0007); the
 * legacy `position` field is unreliable for this. *File*-level comments carry a
 * null `line` by design and are never "outdated".
 */
export function isCommentOutdated(
  line: number | null,
  subjectType: string | null,
): boolean {
  if ((subjectType ?? "line") !== "line") return false;
  return line == null;
}

export function normalizeReviewComment(value: unknown): ReviewComment {
  const c = GhCommentSchema.parse(value);
  return {
    id: String(c.id),
    file: c.path ?? "",
    startLine: c.start_line ?? null,
    line: c.line ?? null,
    originalStartLine: c.original_start_line ?? null,
    originalLine: c.original_line ?? null,
    author: c.user?.login ?? "unknown",
    body: (c.body ?? "").slice(0, MAX_COMMENT_CHARS),
    inReplyToId: c.in_reply_to_id != null ? String(c.in_reply_to_id) : null,
    outdated: isCommentOutdated(c.line ?? null, c.subject_type ?? null),
  };
}

/**
 * Fetch a PR's review comments (line comments + thread replies) via the GitHub
 * API. Stateless, public — display data for the brief + delta comment sidecars
 * (ADR 0012) and input to the delta's "comments addressed" analysis (ADR 0011).
 * Capped in count and per-comment length to bound prompt cost.
 *
 * `outdated` is read straight from GitHub (a nulled `line`, see isCommentOutdated),
 * never recomputed (ADR 0007). NOTE: GitHub computes outdated relative to the PR's
 * *current* head. That is exact for the full brief (always at current head), but
 * for a delta run at an arbitrary (base, head) it is outdated-relative-to-current-
 * PR-head, not the delta's head — a documented limitation, like the three-dot
 * compare-diff caveat above.
 */
export async function fetchReviewComments(
  loc: PrLocator,
): Promise<ReviewComment[]> {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", "--paginate", `repos/${repoSlug(loc)}/pulls/${loc.number}/comments`],
    { maxBuffer: MAX_BUFFER },
  );
  const raw = z.array(GhCommentSchema).parse(JSON.parse(stdout));
  return raw.slice(0, MAX_COMMENTS).map(normalizeReviewComment);
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
