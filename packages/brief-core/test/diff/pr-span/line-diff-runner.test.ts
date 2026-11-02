import { describe, expect, it } from "vitest";
import {
  formatLineDiffPatch,
  PrSpanFailureKinds,
  readPrSpan,
  SpanRunnerError,
  type LineDiffInput,
  type LineDiffRunner,
  type PrSpanRefs,
} from "../../../src/diff/pr-span";
import { LINE_DIFF_MAX_EDIT_LENGTH } from "../../../src/diff/pr-span/consts";
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

const baseText = makeText(makeBaseLines(12));
const withP1 = makeText(insertAfter(makeBaseLines(12), "b5", ["p1"]));
const PATHS = ["b.ts", "a.ts"];

function stubTwoFileSource(): StubSource {
  const blobs: Record<string, string> = {};
  for (const path of PATHS) {
    blobs[`head1:${path}`] = baseText;
    blobs[`head2:${path}`] = withP1;
  }
  return stubSource({
    diffs: {
      "base1..head1": { ok: true, value: makeDiff([]) },
      "base1..head2": {
        ok: true,
        value: makeDiff(
          PATHS.map((path) =>
            makeFilePatch({ path, base: baseText, head: withP1 }),
          ),
        ),
      },
    },
    blobs,
  });
}

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("readPrSpan with an injected line-diff runner", () => {
  it("hands the runner each file in path order under its edit bound", async () => {
    const inputs: LineDiffInput[] = [];
    const recordingRunner: LineDiffRunner = (input) => {
      inputs.push(input);
      return Promise.resolve(formatLineDiffPatch(input));
    };

    const injected = await readPrSpan(
      stubTwoFileSource(),
      REFS,
      makeSignal(),
      recordingRunner,
    );
    const inProcess = await readPrSpan(stubTwoFileSource(), REFS, makeSignal());

    expect(inputs.map((input) => input.contents.path)).toEqual([
      "a.ts",
      "b.ts",
    ]);
    expect(inputs[0]?.maxEditLength).toBe(LINE_DIFF_MAX_EDIT_LENGTH);
    expect(inputs[0]?.contents.newContent).toBe(withP1);
    expect(injected).toEqual(inProcess);
  });

  it("takes the file's fallback when the runner answers no patch", async () => {
    const refusingRunner: LineDiffRunner = () => Promise.resolve(undefined);

    const result = await readPrSpan(
      stubTwoFileSource(),
      REFS,
      makeSignal(),
      refusingRunner,
    );

    expect(result.ok && result.value.changedFiles).toEqual(["a.ts", "b.ts"]);
    expect(result.ok && result.value.unpairableFiles).toEqual(["a.ts", "b.ts"]);
    expect(result.ok && result.value.filteredDiff).toContain("+p1");
  });

  it("reads transient when the runner itself fails", async () => {
    const failingRunner: LineDiffRunner = () =>
      Promise.reject(new SpanRunnerError("thread stopped"));

    const result = await readPrSpan(
      stubTwoFileSource(),
      REFS,
      makeSignal(),
      failingRunner,
    );

    expect(result).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.TRANSIENT },
    });
  });

  it("rethrows a runner's own bug instead of reading transient", async () => {
    const bug = new TypeError("cannot read properties of undefined");
    const buggyRunner: LineDiffRunner = () => Promise.reject(bug);

    await expect(
      readPrSpan(stubTwoFileSource(), REFS, makeSignal(), buggyRunner),
    ).rejects.toBe(bug);
  });

  it("rethrows the abort reason when the read aborts during a diff", async () => {
    const controller = new AbortController();
    const reason = new Error("deadline");
    const abortingRunner: LineDiffRunner = () => {
      controller.abort(reason);
      return Promise.reject(new Error("thread stopped"));
    };

    await expect(
      readPrSpan(stubTwoFileSource(), REFS, controller.signal, abortingRunner),
    ).rejects.toBe(reason);
  });
});
