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
