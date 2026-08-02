// getRepoFile against the injected octokit stub (same idiom as api.test.ts):
// success decodes base64 content; 404 maps to the ABSENT outcome (not an
// error); the size guard rejects before decode; non-file responses (dir,
// symlink, submodule) are sanitized errors; API failures leak no token.
import { RequestError, type Octokit } from "octokit";
import { describe, expect, it, vi } from "vitest";
import { GitHubApiErrorCode } from "../src/errors";
import { getRepoFile, RepoFileKind } from "../src/operations/repo-file";

const LEAKED_TOKEN = "ghs_PLANTED_INSTALLATION_TOKEN";

function requestError(status: number): RequestError {
  return new RequestError(`HTTP ${status}`, status, {
    request: {
      method: "GET",
      url: "https://api.github.com/repos/o/r/contents/.mergebrief/policy.yaml",
      headers: { authorization: `token ${LEAKED_TOKEN}` },
    },
    response: {
      status,
      url: "https://api.github.com/repos/o/r/contents/.mergebrief/policy.yaml",
      headers: {},
      data: { message: "Not Found", token: LEAKED_TOKEN },
    },
  });
}

function mockOctokit(request: ReturnType<typeof vi.fn>): Octokit {
  const stub = { request };
  return stub as unknown as Octokit;
}

/** GitHub-style base64: line-wrapped with trailing newline. */
function githubBase64(text: string): string {
  const raw = Buffer.from(text, "utf8").toString("base64");
  return raw.replace(/(.{60})/g, "$1\n") + "\n";
}

function fileResponse(text: string, overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    data: {
      type: "file",
      size: bytes,
      sha: "abc123def456",
      content: githubBase64(text),
      encoding: "base64",
      ...overrides,
    },
  };
}

describe("getRepoFile", () => {
  it("decodes a base64 file and returns content + blob SHA + size", async () => {
    const text = "version: 1\nentryCommentOnDrafts: true\n";
    const request = vi.fn().mockResolvedValue(fileResponse(text));
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief/settings.yaml",
      maxBytes: 4096,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({
      kind: RepoFileKind.FILE,
      content: text,
      blobSha: "abc123def456",
      size: Buffer.byteLength(text, "utf8"),
    });
  });

  it("omits ref from the request when not given (default-branch semantics)", async () => {
    const request = vi.fn().mockResolvedValue(fileResponse("x"));
    await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief/instructions.md",
      maxBytes: 1024,
    });
    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: "o",
        repo: "r",
        path: ".mergebrief/instructions.md",
      },
    );
  });

  it("passes ref through when given", async () => {
    const request = vi.fn().mockResolvedValue(fileResponse("x"));
    await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief/instructions.md",
      ref: "main",
      maxBytes: 1024,
    });
    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: "o",
        repo: "r",
        path: ".mergebrief/instructions.md",
        ref: "main",
      },
    );
  });

  it("maps a 404 to the ABSENT outcome, not an error", async () => {
    const request = vi.fn().mockRejectedValue(requestError(404));
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief/policy.yaml",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ kind: RepoFileKind.ABSENT });
  });

  it("rejects an oversize file before decode (TOO_LARGE, size + sha kept)", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        type: "file",
        size: 5000,
        sha: "bigblob",
        // Deliberately NOT valid base64 for the claimed size — the guard
        // must fire on `size` alone, before any decode.
        content: "!!!",
        encoding: "base64",
      },
    });
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief/settings.yaml",
      maxBytes: 4096,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({
      kind: RepoFileKind.TOO_LARGE,
      blobSha: "bigblob",
      size: 5000,
    });
  });

  it("accepts a file exactly at the cap", async () => {
    const text = "a".repeat(64);
    const request = vi.fn().mockResolvedValue(fileResponse(text));
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: "f",
      maxBytes: 64,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.kind).toBe(RepoFileKind.FILE);
  });

  it("round-trips multibyte UTF-8 content", async () => {
    const text = "glossary: 予約 — “réservation” ✓\n";
    const request = vi.fn().mockResolvedValue(fileResponse(text));
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief/instructions.md",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    if (result.value.kind !== RepoFileKind.FILE)
      throw new Error("expected file");
    expect(result.value.content).toBe(text);
  });

  it("rejects a directory response (array body) as a sanitized error", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ data: [{ type: "file", name: "a" }] });
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
  });

  it("rejects a symlink response as a sanitized error", async () => {
    const request = vi.fn().mockResolvedValue({
      data: { type: "symlink", size: 20, sha: "s", target: "../elsewhere" },
    });
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief/settings.yaml",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
  });

  it("rejects a followed symlink reported as type 'file' with a target field", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(fileResponse("x", { target: "../outside" }));
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief/settings.yaml",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
  });

  it("rejects a submodule payload carrying submodule_git_url", async () => {
    const request = vi.fn().mockResolvedValue(
      fileResponse("x", {
        submodule_git_url: "https://github.com/o/other.git",
      }),
    );
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: "vendored",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
  });

  it("rejects malformed base64 content as a sanitized error", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        type: "file",
        size: 4,
        sha: "s",
        content: "!!not-base64!!",
        encoding: "base64",
      },
    });
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: "f",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
  });

  it("rejects non-UTF-8 bytes instead of silently substituting U+FFFD", async () => {
    // 0xFF 0xFE 0xFD is not valid UTF-8 in any arrangement.
    const binary = Buffer.from([0xff, 0xfe, 0xfd]).toString("base64");
    const request = vi.fn().mockResolvedValue({
      data: {
        type: "file",
        size: 3,
        sha: "s",
        content: binary,
        encoding: "base64",
      },
    });
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief/policy.yaml",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
  });

  it("re-guards on the DECODED byte count when the reported size understates it", async () => {
    const text = "a".repeat(100);
    const request = vi.fn().mockResolvedValue(
      // GitHub claims 10 bytes; the payload decodes to 100.
      fileResponse(text, { size: 10 }),
    );
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: "f",
      maxBytes: 64,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({
      kind: RepoFileKind.TOO_LARGE,
      blobSha: "abc123def456",
      size: 100,
    });
  });

  it("rejects a non-base64 encoding (e.g. 'none' for giant blobs) as a sanitized error", async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        type: "file",
        size: 100,
        sha: "s",
        content: "",
        encoding: "none",
      },
    });
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: "f",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.REQUEST_FAILED);
  });

  it("maps a 403 to a sanitized error that leaks no token", async () => {
    const request = vi.fn().mockRejectedValue(requestError(403));
    const result = await getRepoFile(mockOctokit(request), {
      owner: "o",
      repo: "r",
      path: ".mergebrief/policy.yaml",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(GitHubApiErrorCode.FORBIDDEN);
    expect(result.error.message).not.toContain(LEAKED_TOKEN);
    expect(JSON.stringify(result.error)).not.toContain(LEAKED_TOKEN);
  });
});
