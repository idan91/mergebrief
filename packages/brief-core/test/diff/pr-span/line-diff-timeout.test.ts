import { afterEach, describe, expect, it, vi } from "vitest";
import { readPrSpan, type PrSpanRefs } from "../../../src/diff/pr-span";
import {
  LINE_DIFF_MAX_EDIT_LENGTH,
  LINE_DIFF_TIMEOUT_MS,
} from "../../../src/diff/pr-span/consts";
import { formatLineDiffPatch } from "../../../src/diff/pr-span/logic/line-diff";
import {
  insertAfter,
  makeBaseLines,
  makeDiff,
  makeFilePatch,
  makeText,
  stubSource,
  type StubSource,
} from "./helpers";

const REFS: PrSpanRefs = {
  prevBase: "base1",
  prevHead: "head1",
  newBase: "base1",
  newHead: "head2",
};

/** A clock step well inside the time limit that a span-wide wall-clock budget would trip on. */
const ONE_SECOND_MS = 1_000;

const PATHS = ["a.ts", "b.ts", "c.ts"];

const base = makeBaseLines(30);
const baseText = makeText(base);
/** Three separate insertions: jsdiff reads the clock once per edit before it finds them. */
const headText = makeText(
  insertAfter(
    insertAfter(insertAfter(base, "b5", ["p1"]), "b15", ["p2"]),
    "b25",
    ["p3"],
  ),
);

function stubSpanSource(): StubSource {
  const blobs: Record<string, string> = {};
  for (const path of PATHS) {
    blobs[`head1:${path}`] = baseText;
    blobs[`head2:${path}`] = headText;
  }
  return stubSource({
    diffs: {
      "base1..head1": { ok: true, value: makeDiff([]) },
      "base1..head2": {
        ok: true,
        value: makeDiff(
          PATHS.map((path) =>
            makeFilePatch({ path, base: baseText, head: headText }),
          ),
        ),
      },
    },
    blobs,
  });
}

/** Every read of `clock` returns a time `stepMs` past the last one. */
function stepClock(clock: { now: () => number }, stepMs: number): void {
  let time = 0;
  vi.spyOn(clock, "now").mockImplementation(() => {
    time += stepMs;
    return time;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readPrSpan when a line diff hits its time limit", () => {
  it("sends each file's fallback patch, never a transient failure", async () => {
    stepClock(Date, LINE_DIFF_TIMEOUT_MS + 1);

    const result = await readPrSpan(
      stubSpanSource(),
      REFS,
      new AbortController().signal,
    );

    const span = result.ok ? result.value : undefined;
    expect(span?.changedFiles).toEqual(PATHS);
    expect(span?.unpairableFiles).toEqual(PATHS);
    expect(span?.hop).toEqual(PATHS.map((file) => ({ file, hunks: [] })));
    expect(span?.filteredDiff).toContain("+p3");
  });
});

describe("formatLineDiffPatch under a time limit its caller passes", () => {
  it("answers no patch at that limit where the default still diffs", () => {
    const input = {
      contents: {
        prevPath: "a.ts",
        path: "a.ts",
        prevContent: baseText,
        newContent: headText,
      },
      maxEditLength: LINE_DIFF_MAX_EDIT_LENGTH,
    };
    stepClock(Date, ONE_SECOND_MS);

    const underDefault = formatLineDiffPatch(input);
    const underPassedLimit = formatLineDiffPatch(input, ONE_SECOND_MS - 1);

    expect(underDefault).toContain("+p3");
    expect(underPassedLimit).toBeUndefined();
  });
});

describe("readPrSpan text against the clock", () => {
  it("is identical when every clock read jumps a second", async () => {
    const idle = await readPrSpan(
      stubSpanSource(),
      REFS,
      new AbortController().signal,
    );
    stepClock(Date, ONE_SECOND_MS);
    stepClock(performance, ONE_SECOND_MS);

    const loaded = await readPrSpan(
      stubSpanSource(),
      REFS,
      new AbortController().signal,
    );

    expect(idle.ok && idle.value.unpairableFiles).toEqual([]);
    expect(loaded).toEqual(idle);
  });
});
