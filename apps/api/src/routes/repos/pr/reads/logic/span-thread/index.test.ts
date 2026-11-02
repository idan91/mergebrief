import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  BlobReadKinds,
  formatLineDiffPatch,
  LINE_DIFF_TIMEOUT_MS,
  PrSpanFailureKinds,
  readPrSpan,
  type BlobRead,
  type LineDiffInput,
  type LineDiffRunner,
  type PrSpanFailure,
  type PrSpanRefs,
  type PrSpanSource,
} from "brief-core/pr-span";
import type { Result } from "types/utils";
import { afterEach, describe, expect, it } from "vitest";
import { createSpanThread, SpanThreadError } from ".";
import type { SpanThread, SpanThreadOptions } from "./types";
import { testLogging } from "../../../../../../../test/logging";

const IDLE_THREAD_SCRIPT = new URL(
  "../../../../../../../test/fixtures/idle-span-thread.ts",
  import.meta.url,
);
const IDLE_EXIT_TIMEOUT_MS = 15_000;
const ECHO_THREAD = new URL(
  "../../../../../../../test/fixtures/echo-span-thread.ts",
  import.meta.url,
);
const SLOW_PAIR_LINES = 40_000;
const UNBOUNDED_EDIT_LENGTH = 1_000_000;
const TICK_MS = 10;
/** Room past a real jsdiff timeout for the thread's start and the test's own reads. */
const SLOW_TEST_MARGIN_MS = 15_000;
const SLOW_TEST_TIMEOUT_MS = LINE_DIFF_TIMEOUT_MS + SLOW_TEST_MARGIN_MS;
const PROBE_ENV_KEY = "SPAN_THREAD_PROBE";
/** A limit a fresh thread's start under a loaded test run stays inside: its start counts against the first answer. */
const COLD_START_LIMIT_MS = 5_000;
const COLD_START_TEST_TIMEOUT_MS = COLD_START_LIMIT_MS * 4;
const SHORT_BACKOFF_MS = 100;
const BLOB_ID_LENGTH = 7;
const ADDED_BLOB_ID = "0000000";
const FILE_MODE = "100644";
/** Node #65881's push: about 2,250 files and 6 MB in each head's PR diff. */
const SIZED_PR_FILES = 2_250;
const SIZED_HUNKS_PER_FILE = 6;
const SIZED_HUNK_STRIDE = 40;
const SIZED_RUN_LINES = 4;
const SIZED_CONTEXT_LINES = 3;
/** Lines the base gained above every hunk between the two heads. */
const SIZED_BASE_SHIFT = 5;
const SIZED_REWRITTEN_FILES = 3;
/**
 * The thread leaves at most this share of the in-process path's longest step
 * on the event loop: a ratio holds under coverage and load, where a fixed
 * millisecond bar does not.
 */
const IN_PROCESS_STEP_SHARE = 0.25;
const WATCHDOG_INTERVAL_MS = 1;
const SIZED_TEST_TIMEOUT_MS = 60_000;
const MICROSECONDS_PER_MS = 1_000;
const REFS: PrSpanRefs = {
  prevBase: "base1",
  prevHead: "head1",
  newBase: "base1",
  newHead: "head2",
};

const threads: SpanThread[] = [];

function startThread(options?: SpanThreadOptions): SpanThread {
  const thread = createSpanThread(options);
  threads.push(thread);
  return thread;
}

function makeInput(path: string, maxEditLength = 100): LineDiffInput {
  return {
    contents: { prevPath: path, path, prevContent: "a\n", newContent: "b\n" },
    maxEditLength,
  };
}

function makeDistinctLines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, line) => `${prefix}${line}\n`).join(
    "",
  );
}

const SIGNAL = new AbortController().signal;

function readOutcome(
  outcome: PromiseSettledResult<string | undefined>,
): string {
  if (outcome.status === "fulfilled") {
    return String(outcome.value);
  }
  const reason: unknown = outcome.reason;
  return `rejected: ${reason instanceof Error ? reason.message : "unknown"}`;
}

function makeText(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

function makeLines(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, line) => `${prefix}${line}`);
}

function makeBlobId(content: string): string {
  return createHash("sha1")
    .update(content)
    .digest("hex")
    .slice(0, BLOB_ID_LENGTH);
}

/** A PR diff's patch for one file, `base` absent for a file the PR adds, with the `index` line GitHub writes. */
function makePrFilePatch(
  path: string,
  base: string | undefined,
  head: string,
): string {
  const patch = formatLineDiffPatch({
    contents: { prevPath: path, path, prevContent: base, newContent: head },
    maxEditLength: UNBOUNDED_EDIT_LENGTH,
  });
  const lines = (patch ?? "").split("\n");
  const preId = base === undefined ? ADDED_BLOB_ID : makeBlobId(base);
  const mode = base === undefined ? "" : ` ${FILE_MODE}`;
  const at = lines.findIndex((line) => line.startsWith("--- "));
  lines.splice(at, 0, `index ${preId}..${makeBlobId(head)}${mode}`);
  return lines.join("\n");
}

/** A whole-file rewrite patch, written out so no line diff runs to build it. */
function makeRewritePatch(
  path: string,
  base: readonly string[],
  head: readonly string[],
): string {
  return [
    `diff --git a/${path} b/${path}`,
    `index ${makeBlobId(makeText(base))}..${makeBlobId(makeText(head))} ${FILE_MODE}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${base.length} +1,${head.length} @@`,
    ...base.map((line) => `-${line}`),
    ...head.map((line) => `+${line}`),
  ].join("\n");
}

interface SpanFixture {
  /** Keyed `<base>..<head>`. */
  readonly prDiffs: Readonly<Record<string, readonly string[]>>;
  /** Keyed `<ref>:<path>`; a missing key reads absent. */
  readonly blobs: Readonly<Record<string, string>>;
}

function stubSpanSource(fixture: SpanFixture): PrSpanSource {
  return {
    fetchMergeBase(span) {
      const value = `mb:${span.base}..${span.head}`;
      return Promise.resolve({ ok: true, value });
    },
    fetchPrDiff(span) {
      const patches = fixture.prDiffs[`${span.base}..${span.head}`] ?? [];
      return Promise.resolve({ ok: true, value: `${patches.join("\n")}\n` });
    },
    fetchBlob(blob): Promise<Result<BlobRead, PrSpanFailure>> {
      const content = fixture.blobs[`${blob.ref}:${blob.path}`];
      if (content === undefined) {
        return Promise.resolve({
          ok: true,
          value: { kind: BlobReadKinds.ABSENT },
        });
      }
      return Promise.resolve({
        ok: true,
        value: { kind: BlobReadKinds.TEXT, content },
      });
    },
  };
}

interface SizedPatchShape {
  /** `<base blob>..<head blob>`. */
  readonly blobIds: string;
  readonly shift: number;
  readonly runVerb: string;
}

/** A PR patch of hunks around replaced runs, every hunk moved down `shift` lines. */
function makeSizedPrPatch(path: string, shape: SizedPatchShape): string {
  const hunkLines = SIZED_CONTEXT_LINES * 2 + SIZED_RUN_LINES;
  const lines = [
    `diff --git a/${path} b/${path}`,
    `index ${shape.blobIds} ${FILE_MODE}`,
    `--- a/${path}`,
    `+++ b/${path}`,
  ];
  for (let hunk = 0; hunk < SIZED_HUNKS_PER_FILE; hunk += 1) {
    const start = hunk * SIZED_HUNK_STRIDE + 1 + shape.shift;
    lines.push(`@@ -${start},${hunkLines} +${start},${hunkLines} @@`);
    const context = makeLines(` const context${hunk}_`, SIZED_CONTEXT_LINES);
    const runs = makeLines(` value${hunk}_`, SIZED_RUN_LINES);
    lines.push(...context);
    lines.push(...runs.map((line) => `-${line} = readOld("${path}");`));
    lines.push(
      ...runs.map((line) => `+${line} = ${shape.runVerb}("${path}");`),
    );
    lines.push(...context);
  }
  return lines.join("\n");
}

function makeSizedPaths(): string[] {
  return Array.from(
    { length: SIZED_PR_FILES },
    (_, index) => `lib/internal/f${String(index).padStart(4, "0")}.js`,
  );
}

/**
 * Two heads of a Node-sized PR on a moved base: every file's runs match
 * over the move, except the first few, which the new head rewrote.
 */
function makeSizedRebaseFixture(
  prevText: string,
  newText: string,
): SpanFixture {
  const paths = makeSizedPaths();
  const rewritten = paths.slice(0, SIZED_REWRITTEN_FILES);
  const blobs: Record<string, string> = {};
  for (const path of rewritten) {
    blobs[`head1:${path}`] = prevText;
    blobs[`head2:${path}`] = newText;
  }
  const prevPatch = (path: string): string =>
    makeSizedPrPatch(path, {
      blobIds: "1111111..aaaaaaa",
      shift: 0,
      runVerb: "readNew",
    });
  const newPatch = (path: string): string =>
    makeSizedPrPatch(path, {
      blobIds: "2222222..bbbbbbb",
      shift: SIZED_BASE_SHIFT,
      runVerb: rewritten.includes(path) ? "readRewritten" : "readNew",
    });
  return {
    prDiffs: {
      "base1..head1": paths.map(prevPatch),
      "base1..head2": paths.map(newPatch),
    },
    blobs,
  };
}

/** A push that only added commits, its PR diffs over one merge base. */
function stubFastForwardSource(fixture: SpanFixture): PrSpanSource {
  const source = stubSpanSource(fixture);
  return {
    ...source,
    fetchMergeBase(span) {
      const value = span.base === REFS.prevHead ? REFS.prevHead : "fork";
      return Promise.resolve({ ok: true, value });
    },
  };
}

/** The longest stretch of main-thread CPU between two watchdog ticks while `read` runs. */
async function measureLongestMainThreadStep(
  read: () => Promise<unknown>,
): Promise<number> {
  let longestMs = 0;
  let last = process.threadCpuUsage();
  function sample(): void {
    const spent = process.threadCpuUsage(last);
    longestMs = Math.max(
      longestMs,
      (spent.user + spent.system) / MICROSECONDS_PER_MS,
    );
    last = process.threadCpuUsage();
  }
  const watchdog = setInterval(sample, WATCHDOG_INTERVAL_MS);

  await read();
  clearInterval(watchdog);
  sample();
  return longestMs;
}

afterEach(async () => {
  await Promise.all(threads.splice(0).map((thread) => thread.terminate()));
});

describe("createSpanThread", () => {
  it("answers the in-process patch byte for byte", async () => {
    const thread = startThread();
    const inputs: LineDiffInput[] = [
      {
        contents: {
          prevPath: "src/a.ts",
          path: "src/a.ts",
          prevContent: "one\ntwo\nthree\nfour\n",
          newContent: "one\n2\nthree\nfour\nfive",
        },
        maxEditLength: 100,
      },
      {
        contents: {
          prevPath: "bin/run",
          path: "bin/run",
          newContent: "#!/bin/sh\n",
          newMode: "100755",
        },
        maxEditLength: 100,
      },
      {
        contents: {
          prevPath: "old.md",
          path: "old.md",
          prevContent: "gone\n",
          prevMode: "100644",
        },
        maxEditLength: 100,
      },
      {
        contents: {
          prevPath: "lib/old.ts",
          path: "lib/new.ts",
          prevContent: "x\n",
          newContent: "y\n",
          modeChange: { prevMode: "100644", newMode: "100755" },
        },
        maxEditLength: 100,
      },
      makeInput("refused.ts", 1),
    ];

    const answers = await Promise.all(
      inputs.map((input) => thread.runner.runLineDiff(input, SIGNAL)),
    );

    expect(answers).toEqual(inputs.map((input) => formatLineDiffPatch(input)));
    expect(answers[0]).toContain("+five");
    expect(answers.at(-1)).toBeUndefined();
  });

  it(
    "keeps the event loop free and falls back when a diff times out",
    async () => {
      const thread = startThread();
      await thread.runner.runLineDiff(makeInput("warm.ts"), SIGNAL);
      const input: LineDiffInput = {
        contents: {
          prevPath: "big.txt",
          path: "big.txt",
          prevContent: makeDistinctLines("old ", SLOW_PAIR_LINES),
          newContent: makeDistinctLines("new ", SLOW_PAIR_LINES),
        },
        maxEditLength: UNBOUNDED_EDIT_LENGTH,
      };
      let ticks = 0;
      const ticker = setInterval(() => {
        ticks += 1;
      }, TICK_MS);
      const startedAt = Date.now();

      const patch = await thread.runner.runLineDiff(input, SIGNAL);
      clearInterval(ticker);

      expect(patch).toBeUndefined();
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
        LINE_DIFF_TIMEOUT_MS,
      );
      expect(ticks).toBeGreaterThan(LINE_DIFF_TIMEOUT_MS / TICK_MS / 2);
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it("answers a zero edit bound over moved lines and keeps the thread", async () => {
    const thread = startThread();
    const moved: LineDiffInput = {
      contents: {
        prevPath: "src/a.ts",
        path: "src/a.ts",
        prevContent: "one\ntwo\nthree\n",
        newContent: "three\ntwo\none\n",
      },
      maxEditLength: 0,
    };

    const answer = await thread.runner.runLineDiff(moved, SIGNAL);
    const next = await thread.runner.runLineDiff(
      makeInput("after.ts", 100),
      SIGNAL,
    );

    expect(answer).toBe(formatLineDiffPatch(moved));
    expect(next).toBe(formatLineDiffPatch(makeInput("after.ts", 100)));
  });

  it("starts the thread with no node flags and no environment", async () => {
    process.env[PROBE_ENV_KEY] = "inherited";
    const thread = startThread({ entry: ECHO_THREAD });

    const probe = await thread.runner.runLineDiff(makeInput("probe"), SIGNAL);
    delete process.env[PROBE_ENV_KEY];

    expect(JSON.parse(probe ?? "")).toEqual({ execArgv: [], envKeys: [] });
  });

  it("rejects pending diffs when the thread stops, then starts anew", async () => {
    const thread = startThread({ entry: ECHO_THREAD });

    const outcomes = await Promise.allSettled([
      thread.runner.runLineDiff(makeInput("crash"), SIGNAL),
      thread.runner.runLineDiff(makeInput("queued"), SIGNAL),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      expect(outcome.status === "rejected" && outcome.reason).toBeInstanceOf(
        SpanThreadError,
      );
    }
    await expect(
      thread.runner.runLineDiff(makeInput("next"), SIGNAL),
    ).resolves.toBe("next:1");
  });

  it(
    "stops a thread that never answers and fails its diffs",
    async () => {
      const thread = startThread({
        entry: ECHO_THREAD,
        answerLimitMs: COLD_START_LIMIT_MS,
      });

      const outcomes = await Promise.allSettled([
        thread.runner.runLineDiff(makeInput("hang"), SIGNAL),
        thread.runner.runLineDiff(makeInput("queued"), SIGNAL),
      ]);

      expect(outcomes.map(readOutcome)).toEqual([
        "rejected: the span thread stopped",
        "rejected: the span thread stopped",
      ]);
      await expect(
        thread.runner.runLineDiff(makeInput("next"), SIGNAL),
      ).resolves.toBe("next:1");
    },
    COLD_START_TEST_TIMEOUT_MS,
  );

  it("logs one warning per thread stop, with its cause", async () => {
    const logging = testLogging();
    const thread = startThread({ entry: ECHO_THREAD, log: logging.logger });

    await Promise.allSettled([
      thread.runner.runLineDiff(makeInput("crash"), SIGNAL),
      thread.runner.runLineDiff(makeInput("queued"), SIGNAL),
    ]);

    const stops = logging
      .lines()
      .filter(
        (line) => line["msg"] === "span thread stopped; its steps failed",
      );
    expect(stops).toEqual([
      expect.objectContaining({ level: "warn", stopsInARow: 1 }),
    ]);
    expect(stops[0]?.["cause"] ?? stops[0]?.["err"]).toBeDefined();
  });

  it("waits before restarting a thread that stopped twice in a row", async () => {
    const thread = startThread({
      entry: ECHO_THREAD,
      respawnBackoffMs: SHORT_BACKOFF_MS,
    });
    await thread.runner.runLineDiff(makeInput("crash"), SIGNAL).catch(() => "");
    await thread.runner.runLineDiff(makeInput("crash"), SIGNAL).catch(() => "");

    const [early] = await Promise.allSettled([
      thread.runner.runLineDiff(makeInput("early"), SIGNAL),
    ]);
    await new Promise((resolve) => setTimeout(resolve, SHORT_BACKOFF_MS * 2));
    const late = await thread.runner.runLineDiff(makeInput("late"), SIGNAL);

    expect(early.status === "rejected" && early.reason).toBeInstanceOf(
      SpanThreadError,
    );
    expect(late).toBe("late:1");
  });

  it("rejects an answer out of shape and keeps the thread", async () => {
    const thread = startThread({ entry: ECHO_THREAD });

    const [malformed] = await Promise.allSettled([
      thread.runner.runLineDiff(makeInput("malformed"), SIGNAL),
    ]);
    const next = await thread.runner.runLineDiff(makeInput("next"), SIGNAL);

    expect(readOutcome(malformed)).toBe(
      "rejected: the span step answer is malformed",
    );
    expect(next).toBe("next:2");
  });

  it("logs one error for an answer out of shape", async () => {
    const logging = testLogging();
    const thread = startThread({ entry: ECHO_THREAD, log: logging.logger });

    await thread.runner
      .runLineDiff(makeInput("malformed"), SIGNAL)
      .catch(() => "");

    expect(
      logging
        .lines()
        .filter((line) => line["msg"] === "span step answer malformed"),
    ).toEqual([expect.objectContaining({ level: "error" })]);
  });

  it(
    "lets the process exit while the thread is idle",
    async () => {
      const run = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", fileURLToPath(IDLE_THREAD_SCRIPT)],
        { timeout: IDLE_EXIT_TIMEOUT_MS },
      );

      expect(run.stdout).toBe("patch");
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it("never sends a queued diff whose request aborted", async () => {
    const thread = startThread({ entry: ECHO_THREAD });
    const request = new AbortController();

    const first = thread.runner.runLineDiff(makeInput("first"), SIGNAL);
    const dropped = thread.runner.runLineDiff(
      makeInput("dropped"),
      request.signal,
    );
    request.abort(new Error("deadline"));
    const last = thread.runner.runLineDiff(makeInput("last"), SIGNAL);
    const outcomes = await Promise.allSettled([first, dropped, last]);

    expect(outcomes.map(readOutcome)).toEqual([
      "first:1",
      "rejected: deadline",
      "last:2",
    ]);
  });

  it("rejects a diff whose request already aborted", async () => {
    const thread = startThread({ entry: ECHO_THREAD });
    const request = new AbortController();
    request.abort(new Error("gone"));

    await expect(
      thread.runner.runLineDiff(makeInput("late"), request.signal),
    ).rejects.toThrow("gone");
  });

  it("rejects the diff in flight when terminated", async () => {
    const thread = startThread();

    const [outcome] = await Promise.allSettled([
      thread.runner.runLineDiff(makeInput("a.ts"), SIGNAL),
      thread.terminate(),
    ]);

    expect(outcome.status === "rejected" && outcome.reason).toBeInstanceOf(
      SpanThreadError,
    );
  });
});

describe("readPrSpan on the span thread", () => {
  const base = makeLines("b", 12);
  const withP1 = base.toSpliced(5, 0, "p1");
  const withP1AndP2 = withP1.toSpliced(11, 0, "p2");
  const baseText = makeText(base);
  const p1Text = makeText(withP1);
  const p1AndP2Text = makeText(withP1AndP2);

  it("reads the span the in-process runner reads, byte for byte", async () => {
    const thread = startThread();
    const source = stubSpanSource({
      prDiffs: {
        "base1..head1": [
          makePrFilePatch("c.ts", baseText, p1Text),
          makePrFilePatch("d.ts", baseText, p1Text),
        ],
        "base1..head2": [
          makePrFilePatch("c.ts", baseText, p1AndP2Text),
          makePrFilePatch("e.ts", baseText, p1Text),
          makePrFilePatch("n.ts", undefined, p1Text),
        ],
      },
      blobs: {
        "head1:c.ts": p1Text,
        "head2:c.ts": p1AndP2Text,
        "head1:d.ts": p1Text,
        "head2:d.ts": baseText,
        "head1:e.ts": baseText,
        "head2:e.ts": p1Text,
        "head2:n.ts": p1Text,
      },
    });

    const threadPaths: string[] = [];
    const countingRunner: LineDiffRunner = (input, signal) => {
      threadPaths.push(input.contents.path);
      return thread.runner.runLineDiff(input, signal);
    };

    const onThread = await readPrSpan(source, REFS, SIGNAL, {
      ...thread.runner,
      runLineDiff: countingRunner,
    });
    const inProcess = await readPrSpan(source, REFS, SIGNAL);

    expect(threadPaths).toEqual(["c.ts", "d.ts", "e.ts", "n.ts"]);
    expect(onThread).toEqual(inProcess);
    expect(onThread.ok && onThread.value.changedFiles.toSorted()).toEqual(
      threadPaths,
    );
  });

  it(
    "takes the file's fallback when its diff times out on the thread",
    async () => {
      const thread = startThread();
      const prevLines = makeLines("old ", SLOW_PAIR_LINES);
      /** A reordering adds and removes no line, so the span's bounds pass it to the runner. */
      const newLines = prevLines.toReversed();
      const source = stubSpanSource({
        prDiffs: {
          "base1..head2": [makeRewritePatch("big.txt", prevLines, newLines)],
        },
        blobs: {
          "head1:big.txt": makeText(prevLines),
          "head2:big.txt": makeText(newLines),
        },
      });
      // The work bound keeps a timeout out of reach, so lift it to meet one.
      const unboundedRunner: LineDiffRunner = (input, signal) =>
        thread.runner.runLineDiff(
          { ...input, maxEditLength: UNBOUNDED_EDIT_LENGTH },
          signal,
        );
      const startedAt = Date.now();

      const result = await readPrSpan(source, REFS, SIGNAL, {
        ...thread.runner,
        runLineDiff: unboundedRunner,
      });

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
        LINE_DIFF_TIMEOUT_MS,
      );
      expect(result.ok && result.value.changedFiles).toEqual(["big.txt"]);
      expect(result.ok && result.value.unpairableFiles).toEqual(["big.txt"]);
      expect(result.ok && result.value.filteredDiff).toContain("+old 0");
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    "keeps each main-thread step short on a Node-sized rebased PR",
    async () => {
      const thread = startThread();
      await thread.runner.runLineDiff(makeInput("warm.ts"), SIGNAL);
      const source = stubSpanSource(makeSizedRebaseFixture(baseText, p1Text));

      let onThread: Awaited<ReturnType<typeof readPrSpan>> | undefined;
      const longestMs = await measureLongestMainThreadStep(async () => {
        onThread = await readPrSpan(source, REFS, SIGNAL, thread.runner);
      });
      let inProcess: Awaited<ReturnType<typeof readPrSpan>> | undefined;
      const inProcessMs = await measureLongestMainThreadStep(async () => {
        inProcess = await readPrSpan(source, REFS, SIGNAL);
      });

      expect(onThread).toEqual(inProcess);
      expect(inProcess?.ok && inProcess.value.changedFiles).toHaveLength(
        SIZED_REWRITTEN_FILES,
      );
      expect(longestMs).toBeLessThan(inProcessMs * IN_PROCESS_STEP_SHARE);
    },
    SIZED_TEST_TIMEOUT_MS,
  );

  it(
    "reads a Node-sized fast-forward the in-process runner reads",
    async () => {
      const thread = startThread();
      const sized = makeSizedRebaseFixture(baseText, p1Text);
      const source = stubFastForwardSource({
        prDiffs: {
          "base1..head2": sized.prDiffs["base1..head2"] ?? [],
          "head1..head2": [makePrFilePatch("c.ts", baseText, p1Text)],
        },
        blobs: {},
      });

      const onThread = await readPrSpan(source, REFS, SIGNAL, thread.runner);
      const inProcess = await readPrSpan(source, REFS, SIGNAL);

      expect(onThread).toEqual(inProcess);
      expect(inProcess.ok && inProcess.value.changedFiles).toEqual(["c.ts"]);
    },
    SIZED_TEST_TIMEOUT_MS,
  );

  it("reads transient when the thread stops during the read", async () => {
    const thread = startThread({ entry: ECHO_THREAD });
    const source = stubSpanSource({
      prDiffs: { "base1..head2": [makePrFilePatch("crash", baseText, p1Text)] },
      blobs: { "head1:crash": baseText, "head2:crash": p1Text },
    });

    const result = await readPrSpan(source, REFS, SIGNAL, thread.runner);

    expect(result).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.TRANSIENT },
    });
  });
});
