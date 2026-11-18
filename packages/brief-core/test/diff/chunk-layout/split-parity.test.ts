import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { splitUnifiedDiffByFile } from "../../../src/diff/chunk-layout";
import { parseDiffHeaderPaths } from "../../../src/diff/chunk-layout/logic/header-paths";

/** The line-by-line split this package shipped before the indexOf scan. */
function splitByLinesReference(diff: string): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  if (diff.length === 0) {
    return files;
  }
  let currentKey: string | undefined;
  let currentLines: string[] = [];
  let sawDevNullPost = false;
  let pendingPrePath: string | undefined;
  function flush(): void {
    if (currentKey !== undefined) {
      const deleted = sawDevNullPost && pendingPrePath !== undefined;
      files.set(
        deleted ? (pendingPrePath ?? "") : currentKey,
        currentLines.join("\n"),
      );
    }
    currentLines = [];
    sawDevNullPost = false;
  }
  for (const line of diff.split("\n")) {
    const header = parseDiffHeaderPaths(line);
    if (header !== undefined) {
      flush();
      currentKey = header.post;
      pendingPrePath = header.pre;
    }
    if (currentKey !== undefined) {
      if (line.startsWith("+++ /dev/null")) {
        sawDevNullPost = true;
      }
      currentLines.push(line);
    }
  }
  flush();
  return files;
}

const EVAL_CASES = new URL(
  "../../../../../tools/categorizer/eval/cases/",
  import.meta.url,
);

const FIXTURES = [
  "multi-package-types/fixture.json",
  "react-router-11768/fixture.json.gz",
  "kit-11161/fixture.json.gz",
  "next-60530/fixture.json.gz",
];

interface EvalFixture {
  pr: { diff: string };
}

function readFixtureDiff(name: string): string {
  const raw = readFileSync(new URL(name, EVAL_CASES));
  const text = name.endsWith(".gz")
    ? gunzipSync(raw).toString("utf8")
    : raw.toString("utf8");
  const fixture = JSON.parse(text) as EvalFixture;
  return fixture.pr.diff;
}

const EDGE_CASES: Record<string, string> = {
  empty: "",
  "no header": "@@ -1 +1 @@\n-a\n+b\n",
  preamble: "From abc\nSubject: x\n\ndiff --git a/a b/a\n+x\n",
  "no trailing newline": "diff --git a/a b/a\n@@ -1 +1 @@\n-a\n+b",
  "trailing blank lines": "diff --git a/a b/a\n+x\n\n\n",
  deleted:
    "diff --git a/old b/old\ndeleted file mode 100644\n+++ /dev/null\n-x\n",
  "dev null in content": "diff --git a/a b/a\n@@ -0,0 +1 @@\n+++ /dev/null\n",
  "header lookalike": "diff --git a/a b/a\n+x\ndiff --git broken\n+y\n",
  "carriage return header":
    "diff --git a/a b/a\r\n+x\r\ndiff --git a/b b/b\n+y\n",
  "duplicate key":
    "diff --git a/a b/a\n+1\ndiff --git a/b b/b\n+2\ndiff --git a/a b/a\n+3\n",
  "header at end": "diff --git a/a b/a\n+x\ndiff --git a/b b/b",
  "spaces in path": "diff --git a/my dir/a b.ts b/my dir/a b.ts\n+x\n",
  renamed:
    "diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\n",
  "separator in content":
    "diff --git a/a b/a\n+\ndiff --git \n-diff --git a/x b/x\n",
};

function listEntries(files: ReadonlyMap<string, string>): [string, string][] {
  return [...files.entries()];
}

describe("splitUnifiedDiffByFile parity", () => {
  it.each(FIXTURES)("splits %s exactly like the line split", (name) => {
    const diff = readFixtureDiff(name);

    const files = splitUnifiedDiffByFile(diff);

    expect(files.size).toBeGreaterThan(0);
    expect(listEntries(files)).toEqual(
      listEntries(splitByLinesReference(diff)),
    );
  });

  it.each(Object.entries(EDGE_CASES))(
    "splits the %s case exactly like the line split",
    (_label, diff) => {
      const files = splitUnifiedDiffByFile(diff);

      expect(listEntries(files)).toEqual(
        listEntries(splitByLinesReference(diff)),
      );
    },
  );
});
