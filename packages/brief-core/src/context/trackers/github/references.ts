import { TicketTrackers } from "types/trackers";
import { findIssuesRepo, type RepoName } from "generators/trackers";
import { ReferenceLocations, type ReferenceLocation } from "../../../types";
import { isPathSegment } from "../../../github/pr-url";
import { createEmbeddedUrlCheck } from "../../embedded-urls";
import type { ReferenceHit, TicketReferenceInput } from "../types";

/**
 * GitHub caps logins at 39 chars and repo names at 100; the bounds keep
 * backtracking constant per position. A URL counts only where a link
 * starts: at the start, after whitespace or `<`, after a GFM autolink's
 * delimiters `*`, `_`, `~` or `(`, or at a table cell's `|`. Closing `_`
 * delimiters end the URL; a `_` running on into a name does not.
 */
const GITHUB_ISSUE_URL =
  /(?<=^|[\s<*_~(|])https?:\/\/github\.com\/([A-Za-z0-9_.-]{1,39})\/([A-Za-z0-9_.-]{1,100})\/issues\/(\d{1,12})(?![A-Za-z0-9-]|_+[A-Za-z0-9-])/g;
const OWNER_REPO_HASH =
  /(?<![\w/.-])([A-Za-z0-9_.-]{1,39})\/([A-Za-z0-9_.-]{1,100})#(\d{1,12})(?!\w)/g;
/** A `#N` glued to a name is part of `owner/repo#N`, never a bare reference. */
const BARE_HASH = /(?<![\w/#.-])#(\d{1,12})(?!\w)/g;
/**
 * `12-fix` or `feature/12-fix`: the number leads the branch or sits under
 * one type prefix, the shapes GitHub's "create a branch" and the common
 * `type/N-slug` produce. Deeper segments are stack positions or slugs.
 */
const BRANCH_SEGMENT = /^(?:[^/]+\/)?(\d+)-/g;

function buildIssueUrl(owner: string, repo: string, number: number): string {
  return `https://github.com/${owner}/${repo}/issues/${number}`;
}

/** Where a bare `#N` resolves: `issuesRepo` when the block names one, else the PR's own repo. */
function resolveIssuesRepo(input: TicketReferenceInput): RepoName {
  return findIssuesRepo(input.trackers) ?? input.repo;
}

/** `.` and `..` match the name grammar but would rewrite the API route. */
function isRepoName(owner: string, repo: string): boolean {
  const segmentsSafe = isPathSegment(owner) && isPathSegment(repo);
  return segmentsSafe;
}

function buildHit(
  index: number,
  owner: string,
  repo: string,
  number: number,
): ReferenceHit {
  return {
    index,
    reference: {
      tracker: TicketTrackers.GITHUB,
      key: "",
      number,
      url: buildIssueUrl(owner, repo, number),
    },
  };
}

function collectMentions(
  text: string,
  input: TicketReferenceInput,
  short: boolean,
): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  const own = resolveIssuesRepo(input);

  const isEmbedded = createEmbeddedUrlCheck(text);
  for (const match of text.matchAll(GITHUB_ISSUE_URL)) {
    const owner = match[1] ?? "";
    const repo = match[2] ?? "";
    if (isEmbedded(match.index) || !isRepoName(owner, repo)) {
      continue;
    }
    const number = Number(match[3]);
    hits.push(buildHit(match.index, owner, repo, number));
  }
  if (!short) {
    return hits;
  }

  for (const match of text.matchAll(OWNER_REPO_HASH)) {
    const owner = match[1] ?? "";
    const repo = match[2] ?? "";
    if (isRepoName(owner, repo)) {
      const number = Number(match[3]);
      hits.push(buildHit(match.index, owner, repo, number));
    }
  }
  for (const match of text.matchAll(BARE_HASH)) {
    hits.push(buildHit(match.index, own.owner, own.repo, Number(match[1])));
  }
  return hits;
}

function collectBranchSegments(
  branch: string,
  input: TicketReferenceInput,
): ReferenceHit[] {
  const own = resolveIssuesRepo(input);
  const hits: ReferenceHit[] = [];

  for (const match of branch.matchAll(BRANCH_SEGMENT)) {
    const number = match[1] ?? "";
    const index = match.index + match[0].length - number.length - 1;
    hits.push(buildHit(index, own.owner, own.repo, Number(number)));
  }
  return hits;
}

/**
 * Whether `#N`, `owner/repo#N` and a branch's `N-` count as tickets. A repo
 * that names other trackers and no github entry keeps its tickets there,
 * and a bare number in its PRs is nearly always another pull request.
 */
function readsShortReferences(input: TicketReferenceInput): boolean {
  if (input.trackers.length === 0) {
    return true;
  }
  return input.trackers.some(
    (tracker) => tracker.kind === TicketTrackers.GITHUB,
  );
}

/**
 * Issue URLs wherever the deployment can read GitHub, since a reference no
 * read can follow stays ordinary text; the short forms only where GitHub is
 * the repo's tracker or one of them.
 */
export function collectGitHubReferences(
  text: string,
  location: ReferenceLocation,
  input: TicketReferenceInput,
): ReferenceHit[] {
  if (!input.readable.includes(TicketTrackers.GITHUB)) {
    return [];
  }
  const short = readsShortReferences(input);
  if (location === ReferenceLocations.BRANCH) {
    return short ? collectBranchSegments(text, input) : [];
  }
  return collectMentions(text, input, short);
}

export function canonicalizeGitHubUrl(raw: string): string | undefined {
  const issue = new RegExp(`^${GITHUB_ISSUE_URL.source}`).exec(raw);
  if (issue === null) {
    return undefined;
  }
  return buildIssueUrl(issue[1] ?? "", issue[2] ?? "", Number(issue[3]));
}
