// The attachments-branch write: an orphan branch on first upload, one commit
// per file after that, a lost ref race retried a bounded number of times,
// and a refused push surfacing as forbidden. REST is stubbed at the
// `octokit.rest.git` seam.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  commitAttachment,
  deleteAttachmentBranch,
} from "../src/operations/attachment-branch";
import { LEAKED_TOKEN } from "./fixtures/graphql-error";

const INPUT = {
  owner: "o",
  repo: "r",
  branch: "mergebrief/attachments",
  path: "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00.png",
  bytes: new Uint8Array([137, 80, 78, 71]),
} as const;

interface GitStub {
  readonly getRef: ReturnType<typeof vi.fn>;
  readonly getCommit: ReturnType<typeof vi.fn>;
  readonly deleteRef: ReturnType<typeof vi.fn>;
  readonly createBlob: ReturnType<typeof vi.fn>;
  readonly createTree: ReturnType<typeof vi.fn>;
  readonly createCommit: ReturnType<typeof vi.fn>;
  readonly createRef: ReturnType<typeof vi.fn>;
  readonly updateRef: ReturnType<typeof vi.fn>;
}

function makeRequestError(status: number, message = `status ${status}`) {
  return new RequestError(message, status, {
    request: {
      method: "POST",
      url: "https://api.github.com",
      headers: { authorization: `token ${LEAKED_TOKEN}` },
    },
    response: { status, url: "https://api.github.com", headers: {}, data: {} },
  });
}

function stubGit(overrides: Partial<GitStub> = {}): {
  octokit: Octokit;
  git: GitStub;
} {
  const git: GitStub = {
    getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "head1" } } }),
    // The head commit's tree is named after the commit, so a pin can tell
    // which head a tree was built on.
    getCommit: vi.fn(async ({ commit_sha }: { commit_sha: string }) => ({
      data: { tree: { sha: `tree-of-${commit_sha}` } },
    })),
    deleteRef: vi.fn().mockResolvedValue({ data: {} }),
    createBlob: vi.fn().mockResolvedValue({ data: { sha: "blob1" } }),
    createTree: vi.fn().mockResolvedValue({ data: { sha: "tree1" } }),
    createCommit: vi.fn().mockResolvedValue({
      data: { sha: "commit1", tree: { sha: "tree1" } },
    }),
    createRef: vi.fn().mockResolvedValue({ data: {} }),
    updateRef: vi.fn().mockResolvedValue({ data: {} }),
    ...overrides,
  };
  const stub = { rest: { git } };
  return { octokit: stub as unknown as Octokit, git };
}

describe("commitAttachment", () => {
  it("creates an orphan branch when the ref is absent", async () => {
    const { octokit, git } = stubGit({
      getRef: vi.fn().mockRejectedValue(makeRequestError(404)),
    });

    const result = await commitAttachment(octokit, INPUT);

    expect(result).toEqual({ ok: true, value: { commitSha: "commit1" } });
    expect(git.createBlob.mock.calls[0]?.[0]).toMatchObject({
      owner: "o",
      repo: "r",
      encoding: "base64",
      content: Buffer.from(INPUT.bytes).toString("base64"),
    });
    const tree = git.createTree.mock.calls[0]?.[0];
    expect(tree).toMatchObject({
      tree: [{ path: INPUT.path, mode: "100644", type: "blob", sha: "blob1" }],
    });
    expect(tree).not.toHaveProperty("base_tree");
    expect(git.createCommit.mock.calls[0]?.[0]).toMatchObject({
      tree: "tree1",
      parents: [],
    });
    expect(git.createRef.mock.calls[0]?.[0]).toMatchObject({
      ref: "refs/heads/mergebrief/attachments",
      sha: "commit1",
    });
    expect(git.updateRef).not.toHaveBeenCalled();
  });

  it("appends one commit on the head when the ref exists", async () => {
    const { octokit, git } = stubGit({
      getRef: vi.fn().mockResolvedValue({
        data: { object: { sha: "head1" } },
      }),
    });
    git.createCommit.mockResolvedValueOnce({
      data: { sha: "commit2", tree: { sha: "tree2" } },
    });

    const result = await commitAttachment(octokit, INPUT);

    expect(result).toEqual({ ok: true, value: { commitSha: "commit2" } });
    expect(git.getRef.mock.calls[0]?.[0]).toMatchObject({
      ref: "heads/mergebrief/attachments",
    });
    expect(git.getCommit.mock.calls[0]?.[0]).toMatchObject({
      commit_sha: "head1",
    });
    expect(git.createTree.mock.calls[0]?.[0]).toMatchObject({
      base_tree: "tree-of-head1",
    });
    expect(git.createCommit.mock.calls[0]?.[0]).toMatchObject({
      parents: ["head1"],
    });
    expect(git.updateRef.mock.calls[0]?.[0]).toMatchObject({
      ref: "heads/mergebrief/attachments",
      sha: "commit2",
      force: false,
    });
    expect(git.createRef).not.toHaveBeenCalled();
  });

  it("re-reads the head and retries when the ref moved", async () => {
    const { octokit, git } = stubGit({
      getRef: vi
        .fn()
        .mockResolvedValueOnce({ data: { object: { sha: "head1" } } })
        .mockResolvedValueOnce({ data: { object: { sha: "head2" } } }),
      updateRef: vi
        .fn()
        .mockRejectedValueOnce(
          makeRequestError(422, "Update is not a fast forward"),
        )
        .mockResolvedValueOnce({ data: {} }),
    });

    const result = await commitAttachment(octokit, INPUT);

    expect(result.ok).toBe(true);
    expect(git.createBlob).toHaveBeenCalledTimes(1);
    expect(git.createTree).toHaveBeenCalledTimes(2);
    expect(git.createTree.mock.calls[1]?.[0]).toMatchObject({
      base_tree: "tree-of-head2",
    });
    expect(git.updateRef).toHaveBeenCalledTimes(2);
  });

  it("appends after a lost race to create the branch", async () => {
    const { octokit, git } = stubGit({
      getRef: vi
        .fn()
        .mockRejectedValueOnce(makeRequestError(404))
        .mockResolvedValueOnce({ data: { object: { sha: "head1" } } }),
      createRef: vi
        .fn()
        .mockRejectedValueOnce(
          makeRequestError(422, "Reference already exists"),
        ),
    });

    const result = await commitAttachment(octokit, INPUT);

    expect(result.ok).toBe(true);
    expect(git.createRef).toHaveBeenCalledTimes(1);
    expect(git.updateRef).toHaveBeenCalledTimes(1);
    expect(git.createCommit.mock.calls[1]?.[0]).toMatchObject({
      parents: ["head1"],
    });
  });

  it("gives up once the attempts run out", async () => {
    const { octokit, git } = stubGit({
      updateRef: vi
        .fn()
        .mockRejectedValue(
          makeRequestError(422, "Update is not a fast forward"),
        ),
    });

    const result = await commitAttachment(octokit, INPUT);

    expect(git.updateRef).toHaveBeenCalledTimes(4);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("surfaces a push the App may not make as forbidden", async () => {
    const { octokit } = stubGit({
      updateRef: vi.fn().mockRejectedValue(makeRequestError(403)),
    });

    const result = await commitAttachment(octokit, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(result.error.status).toBe(403);
  });

  it("reads a ruleset rejection as a rule refusal", async () => {
    const { octokit, git } = stubGit({
      updateRef: vi
        .fn()
        .mockRejectedValue(
          makeRequestError(422, "Repository rule violations found"),
        ),
    });

    const result = await commitAttachment(octokit, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.RULE_REFUSED);
    expect(git.updateRef).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected tree as a failure without retrying", async () => {
    const { octokit, git } = stubGit({
      createTree: vi.fn().mockRejectedValue(makeRequestError(422, "bad tree")),
    });

    const result = await commitAttachment(octokit, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(result.error.message).not.toContain("moving");
    expect(git.getRef).toHaveBeenCalledTimes(1);
  });

  it("never carries the token or upstream text in an error", async () => {
    const { octokit } = stubGit({
      createBlob: vi.fn().mockRejectedValue(makeRequestError(500)),
    });

    const result = await commitAttachment(octokit, INPUT);

    expect(JSON.stringify(result)).not.toContain(LEAKED_TOKEN);
    expect(result.ok).toBe(false);
  });
});

describe("deleteAttachmentBranch", () => {
  const TARGET = { owner: "o", repo: "r", branch: "mergebrief/attachments" };

  it("deletes the branch ref", async () => {
    const { octokit, git } = stubGit();

    const result = await deleteAttachmentBranch(octokit, TARGET);

    expect(result).toEqual({ ok: true, value: { existed: true } });
    expect(git.deleteRef).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      ref: "heads/mergebrief/attachments",
    });
  });

  it("treats a missing branch as already deleted", async () => {
    const { octokit } = stubGit({
      deleteRef: vi
        .fn()
        .mockRejectedValue(makeRequestError(422, "Reference does not exist")),
    });

    const result = await deleteAttachmentBranch(octokit, TARGET);

    expect(result).toEqual({ ok: true, value: { existed: false } });
  });

  it("reads a rule refusing the delete as a rule refusal", async () => {
    const { octokit } = stubGit({
      deleteRef: vi
        .fn()
        .mockRejectedValue(
          makeRequestError(422, "Cannot delete this protected branch"),
        ),
    });

    const result = await deleteAttachmentBranch(octokit, TARGET);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.RULE_REFUSED);
  });

  it("surfaces a refused delete as forbidden without the token", async () => {
    const { octokit } = stubGit({
      deleteRef: vi.fn().mockRejectedValue(makeRequestError(403)),
    });

    const result = await deleteAttachmentBranch(octokit, TARGET);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });
});
