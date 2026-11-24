import type { Result } from "types/utils";

import {
  postedReplySchema,
  reviewCommentSchema,
  stackResponseSchema,
} from "../schemas";
import type { CommandRunner, PullSnapshot } from "../types";

export interface RepoSlug {
  readonly owner: string;
  readonly name: string;
}

export interface PostedReply {
  readonly id: number;
  readonly url: string;
}

const GITHUB_REMOTE = /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?\s*$/;

/** Page sizes for one GraphQL call; a stack PR past these is beyond what the tool reports. */
const PAGE = { threads: 100, reviews: 100, comments: 100 };
const THREAD_COMMENT =
  "databaseId author { login __typename } createdAt path line";

export function parseRepoSlug(remoteUrl: string): Result<RepoSlug, Error> {
  const match = GITHUB_REMOTE.exec(remoteUrl.trim());
  const owner = match?.[1];
  const name = match?.[2];
  if (owner === undefined || name === undefined) {
    // An https remote can embed a token; never echo it.
    const shown = remoteUrl.trim().replace(/\/\/[^@/]+@/, "//***@");
    return {
      ok: false,
      error: new Error(`origin is not a GitHub remote: ${shown}`),
    };
  }
  return { ok: true, value: { owner, name } };
}

export function buildStackQuery(numbers: readonly number[]): string {
  const pulls = numbers.map(
    (number) => `pr${number}: pullRequest(number: ${number}) {
      number state isDraft headRefName baseRefName headRefOid
      commits(last: 1) { nodes { commit { committedDate checkSuites(first: 10) { nodes { createdAt } } } } }
      reviews(last: ${PAGE.reviews}) { nodes { databaseId author { login __typename } state submittedAt comments(first: 20) { nodes { databaseId } } } }
      comments(last: ${PAGE.comments}) { nodes { databaseId author { login __typename } createdAt } }
      reviewThreads(first: ${PAGE.threads}) { pageInfo { hasNextPage } nodes { isResolved isOutdated root: comments(first: 1) { nodes { ${THREAD_COMMENT} } } latest: comments(last: 1) { nodes { ${THREAD_COMMENT} } } } }
    }`,
  );
  return `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    ${pulls.join("\n    ")}
  }
}`;
}

function parseJson(text: string): Result<unknown, Error> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return {
      ok: false,
      error: new Error(`gh returned invalid JSON: ${String(error)}`),
    };
  }
}

export function parseStackResponse(
  text: string,
  numbers: readonly number[],
): Result<PullSnapshot[], Error> {
  const json = parseJson(text);
  if (!json.ok) {
    return json;
  }
  const parsed = stackResponseSchema.safeParse(json.value);
  if (!parsed.success) {
    return {
      ok: false,
      error: new Error(`unexpected GitHub response: ${parsed.error.message}`),
    };
  }

  const pulls: PullSnapshot[] = [];
  for (const number of numbers) {
    const pull = parsed.data.data.repository[`pr${number}`];
    if (pull === undefined || pull === null) {
      return {
        ok: false,
        error: new Error(`PR #${number} not found in the GitHub response`),
      };
    }
    pulls.push(pull);
  }
  return { ok: true, value: pulls };
}

export function fetchStack(
  gh: CommandRunner,
  slug: RepoSlug,
  numbers: readonly number[],
): Result<PullSnapshot[], Error> {
  const run = gh([
    "api",
    "graphql",
    "-f",
    `query=${buildStackQuery(numbers)}`,
    "-f",
    `owner=${slug.owner}`,
    "-f",
    `name=${slug.name}`,
  ]);
  if (run.status !== 0) {
    return {
      ok: false,
      error: new Error(`gh api graphql failed: ${run.stderr.trim()}`),
    };
  }
  return parseStackResponse(run.stdout, numbers);
}

/**
 * GitHub accepts replies on a thread's root only, so a reply id is resolved
 * to its root first. The body is read from a file to keep shell quoting out of it.
 */
export function postReply(
  gh: CommandRunner,
  slug: RepoSlug,
  pullNumber: number,
  commentId: number,
  bodyFile: string,
): Result<PostedReply, Error> {
  const repo = `repos/${slug.owner}/${slug.name}`;
  const lookup = gh(["api", `${repo}/pulls/comments/${commentId}`]);
  if (lookup.status !== 0) {
    return {
      ok: false,
      error: new Error(
        `comment ${commentId} not readable: ${lookup.stderr.trim()}`,
      ),
    };
  }
  const comment = parseWith(lookup.stdout, reviewCommentSchema);
  if (!comment.ok) {
    return comment;
  }

  const rootId = comment.value.in_reply_to_id ?? comment.value.id;
  const post = gh([
    "api",
    "-X",
    "POST",
    `${repo}/pulls/${pullNumber}/comments/${rootId}/replies`,
    "-F",
    `body=@${bodyFile}`,
  ]);
  if (post.status !== 0) {
    return {
      ok: false,
      error: new Error(`reply on ${rootId} failed: ${post.stderr.trim()}`),
    };
  }
  const posted = parseWith(post.stdout, postedReplySchema);
  if (!posted.ok) {
    return posted;
  }
  return {
    ok: true,
    value: { id: posted.value.id, url: posted.value.html_url },
  };
}

function parseWith<Output>(
  text: string,
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: Output } | { success: false; error: Error };
  },
): Result<Output, Error> {
  const json = parseJson(text);
  if (!json.ok) {
    return json;
  }
  const parsed = schema.safeParse(json.value);
  if (!parsed.success) {
    return {
      ok: false,
      error: new Error(`unexpected GitHub response: ${parsed.error.message}`),
    };
  }
  return { ok: true, value: parsed.data };
}
