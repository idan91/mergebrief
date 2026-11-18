// The checked compare-diff fetch through a REAL Octokit over a counting fetch,
// so the retry plugin's own attempts would show in the call count.
import { Octokit } from "octokit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { retryOptions } from "../src/auth/retry";
import { GitHubApiErrorCodes } from "../src/errors";
import { fetchCheckedCompareDiff } from "../src/operations/pull-request";

const SPAN = { owner: "o", repo: "r", base: "base-sha", head: "head-sha" };

const TWO_FILE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "@@ -1 +1 @@",
  "-a",
  "+b",
  "diff --git a/src/b.ts b/src/b.ts",
  "@@ -1 +1 @@",
  "-c",
  "+d",
  "",
].join("\n");

/** Every backoff wait the loop can take, with room to spare. */
const ALL_BACKOFF_MS = 60_000;

const SHORT_DEADLINE_MS = 50;

type FetchAnswer = () => Response | Promise<Response>;

function answerDiff(body: string, headers: Record<string, string> = {}) {
  return () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "text/plain", ...headers },
    });
}

function answerStatus(status: number): FetchAnswer {
  return () =>
    new Response(JSON.stringify({ message: "nope" }), {
      status,
      headers: { "content-type": "application/json" },
    });
}

/** Answers each call with the next answer, repeating the last. */
function stubFetch(...answers: readonly FetchAnswer[]) {
  let answered = 0;
  return vi.fn(async () => {
    const answer = answers[Math.min(answered, answers.length - 1)];
    answered += 1;
    if (answer === undefined) {
      throw new Error("no answer arranged");
    }
    return answer();
  });
}

/** A fetch that never answers until its signal aborts. */
function stubHangingFetch() {
  return vi.fn(
    (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  );
}

function makeOctokit(fetchImpl: typeof fetch): Octokit {
  return new Octokit({
    auth: "token",
    retry: { ...retryOptions(), retryAfterBaseValue: 1 },
    throttle: { enabled: false },
    request: { fetch: fetchImpl },
  });
}

async function runWithFakeTimers<Value>(
  pending: () => Promise<Value>,
): Promise<Value> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const result = pending();
  await vi.advanceTimersByTimeAsync(ALL_BACKOFF_MS);
  return result;
}

describe("fetchCheckedCompareDiff", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a diff holding the expected file count", async () => {
    const fetchImpl = stubFetch(answerDiff(TWO_FILE_DIFF));

    const result = await fetchCheckedCompareDiff(makeOctokit(fetchImpl), {
      ...SPAN,
      expectedFileCount: 2,
    });

    expect(result).toEqual({ ok: true, value: TWO_FILE_DIFF });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("answers diff-incomplete when the diff holds fewer files", async () => {
    const fetchImpl = stubFetch(answerDiff(TWO_FILE_DIFF));

    const result = await fetchCheckedCompareDiff(makeOctokit(fetchImpl), {
      ...SPAN,
      expectedFileCount: 3,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.DIFF_INCOMPLETE },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("answers diff-incomplete on an identity reply short of its length", async () => {
    const declared = String(Buffer.byteLength(TWO_FILE_DIFF) + 10);
    const fetchImpl = stubFetch(
      answerDiff(TWO_FILE_DIFF, { "content-length": declared }),
    );

    const result = await fetchCheckedCompareDiff(makeOctokit(fetchImpl), SPAN);

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.DIFF_INCOMPLETE },
    });
  });

  it("accepts an identity reply whose bytes match its length", async () => {
    const declared = String(Buffer.byteLength(TWO_FILE_DIFF));
    const fetchImpl = stubFetch(
      answerDiff(TWO_FILE_DIFF, { "content-length": declared }),
    );

    const result = await fetchCheckedCompareDiff(makeOctokit(fetchImpl), SPAN);

    expect(result).toEqual({ ok: true, value: TWO_FILE_DIFF });
  });

  it("skips the byte check on a compressed reply", async () => {
    const fetchImpl = stubFetch(
      answerDiff(TWO_FILE_DIFF, {
        "content-encoding": "gzip",
        "content-length": "1",
      }),
    );

    const result = await fetchCheckedCompareDiff(makeOctokit(fetchImpl), SPAN);

    expect(result).toEqual({ ok: true, value: TWO_FILE_DIFF });
  });

  it("retries a 5xx and returns the diff a later attempt reads", async () => {
    const fetchImpl = stubFetch(answerStatus(502), answerDiff(TWO_FILE_DIFF));

    const result = await runWithFakeTimers(() =>
      fetchCheckedCompareDiff(makeOctokit(fetchImpl), SPAN),
    );

    expect(result).toEqual({ ok: true, value: TWO_FILE_DIFF });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops after three attempts with the retry plugin off", async () => {
    const fetchImpl = stubFetch(answerStatus(502));

    const result = await runWithFakeTimers(() =>
      fetchCheckedCompareDiff(makeOctokit(fetchImpl), SPAN),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.REQUEST_FAILED, status: 502 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("answers diff-timed-out after three 422s", async () => {
    const fetchImpl = stubFetch(answerStatus(422));

    const result = await runWithFakeTimers(() =>
      fetchCheckedCompareDiff(makeOctokit(fetchImpl), SPAN),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.DIFF_TIMED_OUT, status: 422 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 406 or a 404", async () => {
    const tooLarge = stubFetch(answerStatus(406));
    const missing = stubFetch(answerStatus(404));

    const tooLargeResult = await fetchCheckedCompareDiff(
      makeOctokit(tooLarge),
      SPAN,
    );
    const missingResult = await fetchCheckedCompareDiff(
      makeOctokit(missing),
      SPAN,
    );

    expect(tooLargeResult).toMatchObject({ ok: false, error: { status: 406 } });
    expect(missingResult).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.NOT_FOUND },
    });
    expect(tooLarge).toHaveBeenCalledTimes(1);
    expect(missing).toHaveBeenCalledTimes(1);
  });

  it("answers diff-timed-out once the deadline passes mid-attempt", async () => {
    const fetchImpl = stubHangingFetch();

    const result = await fetchCheckedCompareDiff(makeOctokit(fetchImpl), {
      ...SPAN,
      deadlineMs: SHORT_DEADLINE_MS,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.DIFF_TIMED_OUT },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("makes no attempt past the deadline after a failed one", async () => {
    const fetchImpl = stubFetch(answerStatus(502));

    const result = await fetchCheckedCompareDiff(makeOctokit(fetchImpl), {
      ...SPAN,
      deadlineMs: SHORT_DEADLINE_MS,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.DIFF_TIMED_OUT },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
