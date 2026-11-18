import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PrMetadata } from "brief-core";
import type {
  BlobRef,
  PrDiffRef,
  PrSpanFailure,
  PrSpanSource,
} from "brief-core/pr-span";
import type { Result } from "types/utils";
import {
  capturePair,
  PAIR_GZIP_BYTES,
  writePairCapture,
  type PairCaptureReads,
} from "../eval/pair-capture";
import { loadPairCases } from "../eval/pairs";
import { EXPECTED_TS } from "./pair-fixtures";

const LOC = { owner: "o", repo: "r", number: 7 };
const PR_BASE = "e".repeat(40);
const RETARGET_BASE = "f".repeat(40);
const PREV_HEAD = "a".repeat(40);
const NEW_HEAD = "b".repeat(40);

const A_PATCH = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 line
+added
`;
const B_PATCH = `diff --git a/b.ts b/b.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/b.ts
@@ -0,0 +1,1 @@
+fresh
`;

const HEADER_ONLY_FILES = `diff --git a/logo.png b/logo.png
index 4444444..5555555 100644
Binary files a/logo.png and b/logo.png differ
diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 6666666..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`;

const COMMENT = {
  id: "101",
  file: "a.ts",
  startLine: null,
  line: 2,
  originalStartLine: null,
  originalLine: 2,
  author: "reviewer",
  body: "why",
  inReplyToId: null,
  outdated: false,
};

const META: PrMetadata = {
  title: "Add b",
  body: "adds b",
  url: "https://github.com/o/r/pull/7",
  sha: NEW_HEAD,
  baseSha: PR_BASE,
  commitCount: 3,
  files: [],
};

interface StubSpanSource extends PrSpanSource {
  diffReads: PrDiffRef[];
}

function stubSpanSource(
  failure?: PrSpanFailure,
  newPrDiff = `${A_PATCH}${B_PATCH}`,
  isFastForward = false,
): StubSpanSource {
  const diffReads: PrDiffRef[] = [];
  return {
    diffReads,
    async fetchMergeBase(span): Promise<Result<string, PrSpanFailure>> {
      if (span.base === PREV_HEAD) {
        const mergeBase = isFastForward ? PREV_HEAD : "older";
        return { ok: true, value: mergeBase };
      }
      return { ok: true, value: PR_BASE };
    },
    async fetchPrDiff(span): Promise<Result<string, PrSpanFailure>> {
      diffReads.push(span);
      if (failure !== undefined) {
        return { ok: false, error: failure };
      }
      if (span.base === PREV_HEAD) {
        return { ok: true, value: B_PATCH };
      }
      const diff = span.head === PREV_HEAD ? A_PATCH : newPrDiff;
      return { ok: true, value: diff };
    },
    async fetchBlob(blob: BlobRef) {
      if (blob.path === "b.ts" && blob.ref === NEW_HEAD) {
        return { ok: true, value: { kind: "text", content: "fresh\n" } };
      }
      return { ok: true, value: { kind: "absent" } };
    },
  };
}

const HEAD_DATES = new Map([
  [PREV_HEAD, "2026-10-01T09:00:00Z"],
  [NEW_HEAD, "2026-10-02T09:00:00Z"],
]);

interface StubCaptureReads extends PairCaptureReads {
  commentCutoffs: string[];
}

function stubCaptureReads(): StubCaptureReads {
  const commentCutoffs: string[] = [];
  return {
    commentCutoffs,
    fetchPrMetadata: async () => META,
    fetchReviewCommentsCreatedBy: async (_loc, createdBy) => {
      commentCutoffs.push(createdBy);
      return [COMMENT];
    },
    fetchCommitDate: async (_loc, sha) => HEAD_DATES.get(sha) ?? "unknown",
    fetchCompareCommitCount: async (_loc, _base, head) =>
      head === PREV_HEAD ? 1 : 2,
  };
}

const READS = stubCaptureReads();

const REQUEST = { locator: LOC, prevHead: PREV_HEAD, head: NEW_HEAD };

describe("capturePair", () => {
  it("captures both PR diffs, both spans and the review comments", async () => {
    const captured = await capturePair(
      READS,
      stubSpanSource(),
      REQUEST,
      new AbortController().signal,
    );

    if (!captured.ok) {
      throw new Error(captured.error);
    }
    const file = captured.value;
    expect(file.base.pr.diff).toBe(A_PATCH);
    expect(file.revised.pr.diff).toBe(`${A_PATCH}${B_PATCH}`);
    expect(file.base.commitRange).toEqual({
      base: PR_BASE,
      head: PREV_HEAD,
      commitCount: 1,
    });
    expect(file.revised.pr.meta.files).toEqual([
      { path: "a.ts", additions: 1, deletions: 0 },
      { path: "b.ts", additions: 1, deletions: 0 },
    ]);
    expect(file.increment.filteredSpan).toContain("+fresh");
    expect(file.increment.filteredSpan).not.toContain("a.ts");
    expect(file.increment.unfilteredSpan).toContain("+fresh");
    expect(file.reviewComments).toEqual([COMMENT]);
  });

  it("records the span the production read built", async () => {
    const captured = await capturePair(
      READS,
      stubSpanSource(),
      REQUEST,
      new AbortController().signal,
    );

    if (!captured.ok) {
      throw new Error(captured.error);
    }
    const { span } = captured.value.increment;
    expect(span?.changedFiles).toEqual(["b.ts"]);
    expect(span?.unchangedFiles).toEqual(["a.ts"]);
    expect(span?.isUnchanged).toBe(false);
    expect(span?.hop.map((entry) => entry.file)).toEqual(["a.ts", "b.ts"]);
  });

  it("lists every file of each head's diff, header-only ones included", async () => {
    const captured = await capturePair(
      READS,
      stubSpanSource(undefined, `${A_PATCH}${B_PATCH}${HEADER_ONLY_FILES}`),
      REQUEST,
      new AbortController().signal,
    );

    if (!captured.ok) {
      throw new Error(captured.error);
    }
    expect(captured.value.revised.pr.meta.files).toEqual([
      { path: "a.ts", additions: 1, deletions: 0 },
      { path: "b.ts", additions: 1, deletions: 0 },
      { path: "logo.png", additions: 0, deletions: 0 },
      { path: "run.sh", additions: 0, deletions: 0 },
      { path: "new-name.ts", additions: 0, deletions: 0 },
      { path: "gone.ts", additions: 0, deletions: 2 },
    ]);
  });

  it("reads the previous PR diff a fast-forward span skipped", async () => {
    const span = stubSpanSource(undefined, `${A_PATCH}${B_PATCH}`, true);

    const captured = await capturePair(
      READS,
      span,
      REQUEST,
      new AbortController().signal,
    );

    if (!captured.ok) {
      throw new Error(captured.error);
    }
    expect(captured.value.base.pr.diff).toBe(A_PATCH);
    expect(captured.value.increment.filteredSpan).toBe(B_PATCH);
    expect(span.diffReads).toEqual([
      { base: PR_BASE, head: NEW_HEAD },
      { base: PREV_HEAD, head: NEW_HEAD },
      { base: PR_BASE, head: PREV_HEAD },
    ]);
  });

  it("keeps the review comments written by the head's commit date", async () => {
    const reads = stubCaptureReads();

    const captured = await capturePair(
      reads,
      stubSpanSource(),
      REQUEST,
      new AbortController().signal,
    );

    expect(captured.ok).toBe(true);
    expect(reads.commentCutoffs).toEqual(["2026-10-02T09:00:00Z"]);
  });

  it("reads the previous PR diff against a given previous base", async () => {
    const span = stubSpanSource();

    const captured = await capturePair(
      READS,
      span,
      { ...REQUEST, prevBase: RETARGET_BASE },
      new AbortController().signal,
    );

    expect(captured.ok).toBe(true);
    expect(span.diffReads).toEqual([
      { base: PR_BASE, head: NEW_HEAD },
      { base: RETARGET_BASE, head: PREV_HEAD },
    ]);
  });

  it("names the span failure kind when a PR diff read fails", async () => {
    const captured = await capturePair(
      READS,
      stubSpanSource({ kind: "too-large" }),
      REQUEST,
      new AbortController().signal,
    );

    expect(captured).toEqual({
      ok: false,
      error: "revision span read failed: too-large",
    });
  });
});

describe("writePairCapture", () => {
  it("writes a pair.json the pair loader reads back", async () => {
    const captured = await capturePair(
      READS,
      stubSpanSource(),
      REQUEST,
      new AbortController().signal,
    );
    if (!captured.ok) {
      throw new Error(captured.error);
    }
    const root = mkdtempSync(join(tmpdir(), "capture-"));
    const dir = join(root, "captured");

    const written = writePairCapture(dir, captured.value);
    writeFileSync(join(dir, "expected.ts"), EXPECTED_TS);

    expect(written).toEqual({ ok: true, value: join(dir, "pair.json") });
    const cases = await loadPairCases(root);
    if (!cases.ok) {
      throw new Error(cases.error);
    }
    expect(cases.value[0]?.fixture.filteredSpan).toContain("+fresh");
    expect(cases.value[0]?.fixture.recordedSpan?.unchangedFiles).toEqual([
      "a.ts",
    ]);
  });

  it("gzips a capture past the size bound", async () => {
    const bulk = `+${"x".repeat(PAIR_GZIP_BYTES)}\n`;
    const bigDiff = `${A_PATCH}${B_PATCH.replace("+fresh\n", bulk)}`;
    const captured = await capturePair(
      READS,
      stubSpanSource(undefined, bigDiff),
      REQUEST,
      new AbortController().signal,
    );
    if (!captured.ok) {
      throw new Error(captured.error);
    }
    const dir = mkdtempSync(join(tmpdir(), "capture-"));

    const written = writePairCapture(dir, captured.value);

    expect(written).toEqual({ ok: true, value: join(dir, "pair.json.gz") });
    expect(existsSync(join(dir, "pair.json"))).toBe(false);
  });

  it("refuses to overwrite an existing capture", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-"));
    writeFileSync(join(dir, "pair.json.gz"), "");

    const written = writePairCapture(dir, {} as never);

    expect(written.ok).toBe(false);
  });
});
