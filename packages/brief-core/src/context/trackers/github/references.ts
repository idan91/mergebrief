import {
  ReferenceLocations,
  TicketTrackers,
  type ReferenceLocation,
} from "../../tracker";
import type { ReferenceHit, TicketReferenceInput } from "../types";

/** GitHub caps logins at 39 chars and repo names at 100; the bounds keep backtracking constant per position. */
const GITHUB_ISSUE_URL =
  /https?:\/\/github\.com\/([A-Za-z0-9_.-]{1,39})\/([A-Za-z0-9_.-]{1,100})\/issues\/(\d{1,12})(?![\w-])/g;
const OWNER_REPO_HASH =
  /(?<![\w/.-])([A-Za-z0-9_.-]{1,39})\/([A-Za-z0-9_.-]{1,100})#(\d{1,12})(?!\w)/g;
const BARE_HASH = /(?<![\w/#])#(\d{1,12})(?!\w)/g;
const BRANCH_SEGMENT = /(?:^|\/)(\d+)-/g;

function buildIssueUrl(owner: string, repo: string, number: number): string {
  return `https://github.com/${owner}/${repo}/issues/${number}`;
}

/** Where a bare `#N` resolves: `issuesRepo` when the block names one, else the PR's own repo. */
function resolveIssuesRepo(input: TicketReferenceInput): {
  owner: string;
  repo: string;
} {
  const configured =
    input.tracker?.kind === TicketTrackers.GITHUB
      ? input.tracker.issuesRepo
      : undefined;
  if (configured === undefined) return input.repo;

  const [owner = "", repo = ""] = configured.split("/");
  return { owner, repo };
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
): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  const own = resolveIssuesRepo(input);

  for (const match of text.matchAll(GITHUB_ISSUE_URL)) {
    hits.push(
      buildHit(match.index, match[1] ?? "", match[2] ?? "", Number(match[3])),
    );
  }
  for (const match of text.matchAll(OWNER_REPO_HASH)) {
    hits.push(
      buildHit(match.index, match[1] ?? "", match[2] ?? "", Number(match[3])),
    );
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
    hits.push(buildHit(match.index, own.owner, own.repo, Number(match[1])));
  }
  return hits;
}

/** `#N`, `owner/repo#N`, issue URLs and a branch segment starting `N-`, on every deployment. */
export function collectGitHubReferences(
  text: string,
  location: ReferenceLocation,
  input: TicketReferenceInput,
): ReferenceHit[] {
  if (location === ReferenceLocations.BRANCH) {
    return collectBranchSegments(text, input);
  }
  return collectMentions(text, input);
}

export function canonicalizeGitHubUrl(raw: string): string | undefined {
  const issue = new RegExp(`^${GITHUB_ISSUE_URL.source}`).exec(raw);
  if (issue === null) return undefined;
  return buildIssueUrl(issue[1] ?? "", issue[2] ?? "", Number(issue[3]));
}
