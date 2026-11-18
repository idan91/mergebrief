import { BlobReadKinds, PrSpanFailureKinds } from "brief-core/pr-span";
import {
  CredentialFailureCodes,
  GitHubApiErrorCodes,
  type GitHubCallFailure,
  type RepoFileResult,
} from "github";
import { HttpStatuses } from "types/http";
import type { Result } from "types/utils";
import { describe, expect, it } from "vitest";
import {
  buildWorkerPrSpanSource,
  type CountedPrDiff,
} from "../../src/task/generate/logic/span-source";
import { buildRepoFile } from "./helpers";

const SPAN = { base: "base1", head: "head1" };
const BLOB = { path: "src/a.ts", ref: "head1", maxBytes: 100 };

interface ReadCall {
  readonly args: readonly unknown[];
}

function stubReads(
  diff: Result<string, GitHubCallFailure>,
  file: Result<RepoFileResult, GitHubCallFailure>,
  counted?: CountedPrDiff,
  mergeBase: Result<string, GitHubCallFailure> = { ok: true, value: "mb" },
) {
  const calls: ReadCall[] = [];
  return {
    calls,
    source: buildWorkerPrSpanSource(
      {
        fetchCheckedCompareDiff: (...args) => {
          calls.push({ args });
          return Promise.resolve(diff);
        },
        fetchRepoFileAt: (...args) => {
          calls.push({ args });
          return Promise.resolve(file);
        },
        fetchMergeBase: (...args) => {
          calls.push({ args });
          return Promise.resolve(mergeBase);
        },
      },
      counted,
    ),
  };
}

function makeHttpFailure(status: number, code: string): GitHubCallFailure {
  return { code, status, message: "failed" } as GitHubCallFailure;
}

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

const OK_FILE: Result<RepoFileResult, GitHubCallFailure> = {
  ok: true,
  value: buildRepoFile("a\n", "sha"),
};
const OK_DIFF: Result<string, GitHubCallFailure> = { ok: true, value: "d" };

describe("buildWorkerPrSpanSource PR diff reads", () => {
  it("reads an uncounted head through the checked compare alone", async () => {
    const { source, calls } = stubReads(OK_DIFF, OK_FILE);

    const read = await source.fetchPrDiff(SPAN, makeSignal());

    expect(read).toEqual({ ok: true, value: "d" });
    expect(calls).toEqual([{ args: ["base1", "head1", undefined] }]);
  });

  it("checks the counted head's diff against its file count", async () => {
    const counted = { base: "base2", head: "head2", fileCount: 7 };
    const { source, calls } = stubReads(OK_DIFF, OK_FILE, counted);

    await source.fetchPrDiff(SPAN, makeSignal());
    await source.fetchPrDiff({ base: "base2", head: "head2" }, makeSignal());
    await source.fetchPrDiff({ base: "base1", head: "head2" }, makeSignal());

    expect(calls).toEqual([
      { args: ["base1", "head1", undefined] },
      { args: ["base2", "head2", 7] },
      { args: ["base1", "head2", undefined] },
    ]);
  });

  it.each([
    [HttpStatuses.NOT_ACCEPTABLE, "not-found", PrSpanFailureKinds.TOO_LARGE],
    [
      HttpStatuses.UNPROCESSABLE_CONTENT,
      GitHubApiErrorCodes.REQUEST_FAILED,
      PrSpanFailureKinds.TOO_LARGE,
    ],
    [
      HttpStatuses.UNAUTHORIZED,
      GitHubApiErrorCodes.UNAUTHORIZED,
      PrSpanFailureKinds.UNAVAILABLE,
    ],
    [
      HttpStatuses.FORBIDDEN,
      GitHubApiErrorCodes.FORBIDDEN,
      PrSpanFailureKinds.UNAVAILABLE,
    ],
    [
      HttpStatuses.NOT_FOUND,
      GitHubApiErrorCodes.NOT_FOUND,
      PrSpanFailureKinds.UNAVAILABLE,
    ],
    [
      HttpStatuses.FORBIDDEN,
      GitHubApiErrorCodes.RATE_LIMITED,
      PrSpanFailureKinds.TRANSIENT,
    ],
    [502, GitHubApiErrorCodes.REQUEST_FAILED, PrSpanFailureKinds.TRANSIENT],
  ])("maps a %i %s diff read to %s", async (status, code, kind) => {
    const { source } = stubReads(
      { ok: false, error: makeHttpFailure(status, code) },
      OK_FILE,
    );

    const read = await source.fetchPrDiff(SPAN, makeSignal());

    expect(read).toEqual({ ok: false, error: { kind } });
  });

  it("maps a short diff and an unreadable credential", async () => {
    const short = stubReads(
      {
        ok: false,
        error: { code: GitHubApiErrorCodes.DIFF_INCOMPLETE, message: "short" },
      },
      OK_FILE,
    );
    const revoked = stubReads(
      {
        ok: false,
        error: {
          code: CredentialFailureCodes.CREDENTIAL_UNREADABLE,
          message: "gone",
        } as GitHubCallFailure,
      },
      OK_FILE,
    );

    expect(await short.source.fetchPrDiff(SPAN, makeSignal())).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.TOO_LARGE },
    });
    expect(await revoked.source.fetchPrDiff(SPAN, makeSignal())).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.UNAVAILABLE },
    });
  });

  it("rejects with the abort reason once the run is superseded", async () => {
    const controller = new AbortController();
    controller.abort(new Error("superseded"));
    const { source } = stubReads(OK_DIFF, OK_FILE);

    await expect(source.fetchPrDiff(SPAN, controller.signal)).rejects.toThrow(
      "superseded",
    );
  });
});

describe("buildWorkerPrSpanSource merge-base reads", () => {
  it("reads the merge base of the span", async () => {
    const { source, calls } = stubReads(OK_DIFF, OK_FILE);

    const read = await source.fetchMergeBase(SPAN, makeSignal());

    expect(read).toEqual({ ok: true, value: "mb" });
    expect(calls).toEqual([{ args: ["base1", "head1"] }]);
  });

  it.each([
    [
      HttpStatuses.NOT_FOUND,
      GitHubApiErrorCodes.NOT_FOUND,
      PrSpanFailureKinds.UNAVAILABLE,
    ],
    [502, GitHubApiErrorCodes.REQUEST_FAILED, PrSpanFailureKinds.TRANSIENT],
  ])("maps a %i %s merge-base read to %s", async (status, code, kind) => {
    const failure = {
      ok: false,
      error: makeHttpFailure(status, code),
    } as const;
    const { source } = stubReads(OK_DIFF, OK_FILE, undefined, failure);

    const read = await source.fetchMergeBase(SPAN, makeSignal());

    expect(read).toEqual({ ok: false, error: { kind } });
  });

  it("rejects a merge-base read with the abort reason", async () => {
    const controller = new AbortController();
    controller.abort(new Error("superseded"));
    const { source } = stubReads(OK_DIFF, OK_FILE);

    await expect(
      source.fetchMergeBase(SPAN, controller.signal),
    ).rejects.toThrow("superseded");
  });
});

describe("buildWorkerPrSpanSource blob reads", () => {
  it("reads a file at the ref under the byte bound", async () => {
    const { source, calls } = stubReads(OK_DIFF, OK_FILE);

    const read = await source.fetchBlob(BLOB, makeSignal());

    expect(read).toEqual({
      ok: true,
      value: { kind: BlobReadKinds.TEXT, content: "a\n" },
    });
    expect(calls).toEqual([{ args: ["src/a.ts", "head1", 100] }]);
  });

  it("reads an absent path as absent and an oversized one as unreadable", async () => {
    const absent = stubReads(OK_DIFF, { ok: true, value: { kind: "absent" } });
    const large = stubReads(OK_DIFF, {
      ok: true,
      value: { kind: "too-large", blobSha: "sha", size: 101 },
    });

    expect(await absent.source.fetchBlob(BLOB, makeSignal())).toEqual({
      ok: true,
      value: { kind: BlobReadKinds.ABSENT },
    });
    expect(await large.source.fetchBlob(BLOB, makeSignal())).toEqual({
      ok: true,
      value: { kind: BlobReadKinds.UNREADABLE },
    });
  });

  it.each([GitHubApiErrorCodes.NOT_A_BLOB, GitHubApiErrorCodes.NOT_TEXT])(
    "reads a %s refusal as an unreadable blob",
    async (code) => {
      const { source } = stubReads(OK_DIFF, {
        ok: false,
        error: { code, message: "refused" },
      });

      expect(await source.fetchBlob(BLOB, makeSignal())).toEqual({
        ok: true,
        value: { kind: BlobReadKinds.UNREADABLE },
      });
    },
  );

  it.each([
    [HttpStatuses.NOT_ACCEPTABLE, GitHubApiErrorCodes.REQUEST_FAILED],
    [HttpStatuses.UNPROCESSABLE_CONTENT, GitHubApiErrorCodes.REQUEST_FAILED],
  ])("fails the span as too large on a %i blob read", async (status, code) => {
    const { source } = stubReads(OK_DIFF, {
      ok: false,
      error: makeHttpFailure(status, code),
    });

    expect(await source.fetchBlob(BLOB, makeSignal())).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.TOO_LARGE },
    });
  });

  it("fails a blob read GitHub refuses or cannot serve now", async () => {
    const forbidden = stubReads(OK_DIFF, {
      ok: false,
      error: makeHttpFailure(
        HttpStatuses.FORBIDDEN,
        GitHubApiErrorCodes.FORBIDDEN,
      ),
    });
    const down = stubReads(OK_DIFF, {
      ok: false,
      error: makeHttpFailure(502, GitHubApiErrorCodes.REQUEST_FAILED),
    });

    expect(await forbidden.source.fetchBlob(BLOB, makeSignal())).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.UNAVAILABLE },
    });
    expect(await down.source.fetchBlob(BLOB, makeSignal())).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.TRANSIENT },
    });
  });
});
