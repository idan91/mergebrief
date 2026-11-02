import { describe, expect, it } from "vitest";
import {
  formatLineDiffPatch,
  IN_PROCESS_SPAN_RUNNER,
  PrSpanFailureKinds,
  readPrSpan,
  SpanRunnerError,
  type LineDiffInput,
  type LineDiffRunner,
  type PrSpanInput,
  type PrSpanRefs,
  type PrSpanRunner,
} from "../../../src/diff/pr-span";
import { LINE_DIFF_MAX_EDIT_LENGTH } from "../../../src/diff/pr-span/consts";
import {
  insertAfter,
  makeBaseLines,
  makeDiff,
  makeFastForwardMergeBases,
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

function makeLineDiffRunner(runLineDiff: LineDiffRunner): PrSpanRunner {
  return { ...IN_PROCESS_SPAN_RUNNER, runLineDiff };
}

/** A fast-forward of `b.ts` on one merge base: the push only added commits. */
function stubFastForwardSource(): StubSource {
  return stubSource({
    diffs: {
      "base1..head2": {
        ok: true,
        value: makeDiff([
          makeFilePatch({ path: "b.ts", base: baseText, head: withP1 }),
        ]),
      },
      "head1..head2": {
        ok: true,
        value: makeDiff([
          makeFilePatch({ path: "b.ts", base: baseText, head: withP1 }),
        ]),
      },
    },
    blobs: {},
    mergeBases: makeFastForwardMergeBases(REFS, "fork"),
  });
}

describe("readPrSpan with an injected span runner", () => {
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
      makeLineDiffRunner(recordingRunner),
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
      makeLineDiffRunner(refusingRunner),
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
      makeLineDiffRunner(failingRunner),
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
      readPrSpan(
        stubTwoFileSource(),
        REFS,
        makeSignal(),
        makeLineDiffRunner(buggyRunner),
      ),
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
      readPrSpan(
        stubTwoFileSource(),
        REFS,
        controller.signal,
        makeLineDiffRunner(abortingRunner),
      ),
    ).rejects.toBe(reason);
  });

  it.each([
    ["plan", "planBuiltSpan", stubTwoFileSource],
    ["build", "buildPrSpan", stubTwoFileSource],
    ["fast-forward", "buildFastForwardSpan", stubFastForwardSource],
  ] as const)(
    "reads transient when the %s step fails",
    async (_title, step, makeSource) => {
      const runner: PrSpanRunner = {
        ...IN_PROCESS_SPAN_RUNNER,
        [step]: () => Promise.reject(new SpanRunnerError("thread stopped")),
      };

      const result = await readPrSpan(makeSource(), REFS, makeSignal(), runner);

      expect(result).toEqual({
        ok: false,
        error: { kind: PrSpanFailureKinds.TRANSIENT },
      });
    },
  );

  it("rethrows a step's own bug instead of reading transient", async () => {
    const bug = new TypeError("cannot read properties of undefined");
    const runner: PrSpanRunner = {
      ...IN_PROCESS_SPAN_RUNNER,
      planBuiltSpan: () => Promise.reject(bug),
    };

    await expect(
      readPrSpan(stubTwoFileSource(), REFS, makeSignal(), runner),
    ).rejects.toBe(bug);
  });

  it("rethrows the abort reason when the read aborts during a step", async () => {
    const controller = new AbortController();
    const reason = new Error("deadline");
    const runner: PrSpanRunner = {
      ...IN_PROCESS_SPAN_RUNNER,
      planBuiltSpan: () => {
        controller.abort(reason);
        return Promise.reject(new Error("thread stopped"));
      },
    };

    await expect(
      readPrSpan(stubTwoFileSource(), REFS, controller.signal, runner),
    ).rejects.toBe(reason);
  });

  it("hands the build step the plan's files and the confirmed renames", async () => {
    const built: PrSpanInput[] = [];
    const runner: PrSpanRunner = {
      ...IN_PROCESS_SPAN_RUNNER,
      buildPrSpan: (input, signal) => {
        built.push(input);
        return IN_PROCESS_SPAN_RUNNER.buildPrSpan(input, signal);
      },
    };

    const result = await readPrSpan(
      stubTwoFileSource(),
      REFS,
      makeSignal(),
      runner,
    );

    expect([...(built[0]?.betweenHeads.keys() ?? [])]).toEqual([
      "a.ts",
      "b.ts",
    ]);
    expect(built[0]?.baseRenames).toEqual(new Set());
    expect(result.ok && result.value.changedFiles).toEqual(["a.ts", "b.ts"]);
  });
});
