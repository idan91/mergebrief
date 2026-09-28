// The attachments-branch write, with the App's installation token: the one
// push MergeBrief ever makes to a customer repository. The branch is an
// orphan (a first commit with no parents), every upload is one commit on
// its head, and a lost ref race is settled by re-reading the head, a bounded
// number of times. A push
// the repository refuses (a ruleset on `mergebrief/*`) surfaces as
// forbidden, which the route turns into its own wire code.
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import {
  GitHubApiErrorCodes,
  mapRequestError,
  type GitHubApiError,
} from "../errors";
import type { Result } from "../types";

export interface CommitAttachmentInput {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  /** The file's path on the branch, `<uuid>.<ext>`; the caller minted it. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface AttachmentCommit {
  readonly commitSha: string;
}

export interface DeleteAttachmentBranchInput {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
}

export interface AttachmentBranchDeletion {
  /** False when there was no branch to delete; the outcome is the same. */
  readonly existed: boolean;
}

const CONTEXT = "commit attachment";
const DELETE_CONTEXT = "delete attachment branch";
const BLOB_MODE = "100644";
/**
 * Every attempt re-reads the head, so concurrent uploads settle one per
 * attempt; four covers a burst of uploads from several composers and the
 * CLI while the branch head keeps moving under them.
 */
const MAX_COMMIT_ATTEMPTS = 4;
/**
 * A 422 on the ref write is either a lost race (the head moved, or another
 * upload created the branch first) or the repository refusing the push
 * under a rule. Only the message tells them apart; it is tested, never
 * copied into the result.
 */
const RULE_REJECTION = /rule|protected/i;
/** GitHub answers a delete of a ref that is not there with a 422, not a 404. */
const REF_ABSENT = /does not exist/i;

// A type alias, not an interface: octokit's `RequestParameters` index
// signature is only satisfied implicitly by an object-literal type.
type RepoRef = {
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
};

/** The attempt lost a ref race and the caller may re-read the head. */
const REF_MOVED = "ref-moved";
type AttemptResult =
  | Result<AttachmentCommit, GitHubApiError>
  | typeof REF_MOVED;

function isRuleRejection(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.status === 422 &&
    RULE_REJECTION.test(error.message)
  );
}

function isRefConflict(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.status === 422 &&
    !RULE_REJECTION.test(error.message)
  );
}

function refusedError(context: string): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.RULE_REFUSED,
    status: 422,
    message: `failed to ${context}: a repository rule refused it`,
  };
}

/** The branch head: its commit and, for the tree to build on, that commit's tree. */
interface BranchHead {
  readonly commitSha: string;
  readonly treeSha: string;
}

/** The branch head, or undefined when the branch does not exist yet. */
async function readHead(
  octokit: Octokit,
  target: RepoRef,
): Promise<Result<BranchHead | undefined, GitHubApiError>> {
  try {
    const ref = await octokit.rest.git.getRef(target);
    const commitSha = ref.data.object.sha;
    const commit = await octokit.rest.git.getCommit({
      owner: target.owner,
      repo: target.repo,
      commit_sha: commitSha,
    });
    return { ok: true, value: { commitSha, treeSha: commit.data.tree.sha } };
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) {
      return { ok: true, value: undefined };
    }
    return { ok: false, error: mapRequestError(error, CONTEXT) };
  }
}

async function writeCommit(
  octokit: Octokit,
  input: CommitAttachmentInput,
  blobSha: string,
  head: BranchHead | undefined,
): Promise<string> {
  const { owner, repo, path } = input;
  const treeInput: Parameters<typeof octokit.rest.git.createTree>[0] = {
    owner,
    repo,
    tree: [{ path, mode: BLOB_MODE, type: "blob", sha: blobSha }],
  };
  if (head !== undefined) {
    treeInput.base_tree = head.treeSha;
  }
  const tree = await octokit.rest.git.createTree(treeInput);
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: `Attach ${path}`,
    tree: tree.data.sha,
    parents: head === undefined ? [] : [head.commitSha],
  });
  return commit.data.sha;
}

async function moveRef(
  octokit: Octokit,
  input: CommitAttachmentInput,
  head: BranchHead | undefined,
  commitSha: string,
): Promise<void> {
  const { owner, repo, branch } = input;
  if (head === undefined) {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: commitSha,
    });
    return;
  }
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commitSha,
    force: false,
  });
}

async function attemptCommit(
  octokit: Octokit,
  input: CommitAttachmentInput,
  blobSha: string,
  target: RepoRef,
): Promise<AttemptResult> {
  const head = await readHead(octokit, target);
  if (!head.ok) {
    return head;
  }
  let commitSha: string;
  try {
    commitSha = await writeCommit(octokit, input, blobSha, head.value);
  } catch (error) {
    return { ok: false, error: mapRequestError(error, CONTEXT) };
  }

  // Only the ref move can lose a race; a 422 from the tree or commit call is
  // a bad request and is reported as one.
  try {
    await moveRef(octokit, input, head.value, commitSha);
    return { ok: true, value: { commitSha } };
  } catch (error) {
    if (isRuleRejection(error)) {
      return { ok: false, error: refusedError(CONTEXT) };
    }
    if (isRefConflict(error)) {
      return REF_MOVED;
    }
    return { ok: false, error: mapRequestError(error, CONTEXT) };
  }
}

/**
 * Commit one file to the branch. The blob is written once; the tree, commit
 * and ref move are re-run, a bounded number of times, whenever another
 * upload moved the head in between, so concurrent uploads land as one
 * commit each rather than one lost one.
 */
export async function commitAttachment(
  octokit: Octokit,
  input: CommitAttachmentInput,
): Promise<Result<AttachmentCommit, GitHubApiError>> {
  const { owner, repo, branch } = input;
  const target: RepoRef = { owner, repo, ref: `heads/${branch}` };

  let blobSha: string;
  try {
    const blob = await octokit.rest.git.createBlob({
      owner,
      repo,
      content: Buffer.from(input.bytes).toString("base64"),
      encoding: "base64",
    });
    blobSha = blob.data.sha;
  } catch (error) {
    return { ok: false, error: mapRequestError(error, CONTEXT) };
  }

  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
    // Sequential on purpose: each attempt builds on the head the last one lost to.
    const outcome = await attemptCommit(octokit, input, blobSha, target);
    if (outcome !== REF_MOVED) {
      return outcome;
    }
  }
  return {
    ok: false,
    error: {
      code: GitHubApiErrorCodes.REQUEST_FAILED,
      status: 422,
      message: `failed to ${CONTEXT}: the branch head kept moving`,
    },
  };
}

function isRefAbsent(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.status === 422 &&
    REF_ABSENT.test(error.message)
  );
}

/**
 * Delete the branch outright. Every attachment on it becomes a broken image
 * in the comments that embed one; that consequence is the caller's to
 * confirm. A branch that does not exist is already the requested state; a
 * 404 is the repository itself out of the App's sight and stays an error.
 */
export async function deleteAttachmentBranch(
  octokit: Octokit,
  input: DeleteAttachmentBranchInput,
): Promise<Result<AttachmentBranchDeletion, GitHubApiError>> {
  const { owner, repo, branch } = input;
  try {
    await octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
    return { ok: true, value: { existed: true } };
  } catch (error) {
    if (isRefAbsent(error)) {
      return { ok: true, value: { existed: false } };
    }
    if (isRuleRejection(error)) {
      return { ok: false, error: refusedError(DELETE_CONTEXT) };
    }
    return { ok: false, error: mapRequestError(error, DELETE_CONTEXT) };
  }
}
