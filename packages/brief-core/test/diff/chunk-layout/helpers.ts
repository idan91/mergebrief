import { DiffLineKinds } from "types/diff-lines";
import type { ParsedDiffLine } from "../../../src/diff/chunk-layout";

export const PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,5 +1,6 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 20;",
  "+const c = 3;",
  " const d = 4;",
  " const e = 5;",
  "@@ -20,3 +21,4 @@",
  " function tail() {",
  "+  return 42;",
  " }",
  "\\ No newline at end of file",
].join("\n");

/** A path git writes C-quoted in a header: its non-ASCII bytes as octal escapes. */
export const QUOTED_PATH =
  "packages/kit/test/apps/basics/src/routes/encoded/反应/+page.js";

const QUOTED_SPELLING =
  "packages/kit/test/apps/basics/src/routes/encoded/\\345\\217\\215\\345\\272\\224/+page.js";

export const QUOTED_PATCH = [
  `diff --git "a/${QUOTED_SPELLING}" "b/${QUOTED_SPELLING}"`,
  "index 9a25d2560422..3268b6907cce 100644",
  `--- "a/${QUOTED_SPELLING}"`,
  `+++ "b/${QUOTED_SPELLING}"`,
  "@@ -1,2 +1,2 @@",
  " export function load() {",
  "-  return 1;",
  "+  return 2;",
].join("\n");

/** A file named `x<LF>y`, and one whose decoded path reads as that file's quoted spelling. */
export const LOOKALIKE_QUOTED_FILES = [
  'diff --git "a/x\\ny" "b/x\\ny"',
  "@@ -1 +1 @@",
  "-one",
  "+two",
  'diff --git "a/\\"b/x\\\\ny\\"" "b/\\"b/x\\\\ny\\""',
  "@@ -1 +1 @@",
  "-three",
  "+four",
].join("\n");

/** A file renamed into a path holding ` b/`, so its header splits two ways; git ends its `+++` line with a TAB. */
export const RENAMED_INTO_SPACED_PATH = [
  "diff --git a/old.ts b/dir b/new.ts",
  "similarity index 90%",
  "rename from old.ts",
  "rename to dir b/new.ts",
  "index 1111111..2222222 100644",
  "--- a/old.ts",
  "+++ b/dir b/new.ts\t",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+new",
].join("\n");

/** The same rename with no edit: only the `rename to` line names the new path. */
export const MOVED_INTO_SPACED_PATH = [
  "diff --git a/old.ts b/dir b/new.ts",
  "similarity index 100%",
  "rename from old.ts",
  "rename to dir b/new.ts",
].join("\n");

/** A rename of `x b/y b/x` to `y`, whose header reads as an edit of `x b/y`, beside a real edit of `x b/y`. */
export const RENAME_LIKE_SPACED_EDIT = [
  "diff --git a/x b/y b/x b/y",
  "similarity index 90%",
  "rename from x b/y b/x",
  "rename to y",
  "--- a/x b/y b/x\t",
  "+++ b/y",
  "@@ -1 +1 @@",
  "-renamed old",
  "+renamed new",
  "diff --git a/x b/y b/x b/y",
  "--- a/x b/y\t",
  "+++ b/x b/y\t",
  "@@ -1 +1 @@",
  "-edited old",
  "+edited new",
].join("\n");

/** A deleted file named `x<LF>y`: git keeps its quoted spelling on each side. */
export const DELETED_QUOTED_FILE = [
  'diff --git "a/x\\ny" "b/x\\ny"',
  "deleted file mode 100644",
  "index 1111111..0000000",
  '--- "a/x\\ny"',
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
].join("\n");

export function makeHunk(oldStart: number, newStart: number): ParsedDiffLine {
  return {
    kind: DiffLineKinds.HUNK,
    content: `@@ -${String(oldStart)},4 +${String(newStart)},4 @@`,
  };
}

export function makeCtx(oldLine: number, newLine: number): ParsedDiffLine {
  return {
    kind: DiffLineKinds.CTX,
    content: `ctx ${String(newLine)}`,
    oldLine,
    newLine,
  };
}

export function makeAdd(newLine: number): ParsedDiffLine {
  return {
    kind: DiffLineKinds.ADD,
    content: `add ${String(newLine)}`,
    newLine,
  };
}

export function makeDel(oldLine: number): ParsedDiffLine {
  return {
    kind: DiffLineKinds.DEL,
    content: `del ${String(oldLine)}`,
    oldLine,
  };
}
