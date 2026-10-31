import { describe, expect, it } from "vitest";
import {
  decodeGitPath,
  parseDiffHeaderPaths,
} from "../../../src/diff/chunk-layout/logic/header-paths";

describe("parseDiffHeaderPaths", () => {
  it("reads a plain header unchanged", () => {
    expect(parseDiffHeaderPaths("diff --git a/src/a.ts b/src/a.ts")).toEqual({
      pre: "src/a.ts",
      post: "src/a.ts",
    });
  });

  it("splits a path holding a space and b/ where both halves match", () => {
    expect(parseDiffHeaderPaths("diff --git a/x b/y b/x b/y")).toEqual({
      pre: "x b/y",
      post: "x b/y",
    });
  });

  it.each([
    ['diff --git a/old.txt "b/n\\303\\251w.txt"', "old.txt", "néw.txt"],
    ['diff --git "a/\\303\\251.txt" b/new.txt', "é.txt", "new.txt"],
    ['diff --git "a/q\\"t\\\\.md" "b/q\\"t\\\\.md"', 'q"t\\.md', 'q"t\\.md'],
  ])("decodes a quoted rename side in %s", (line, pre, post) => {
    expect(parseDiffHeaderPaths(line)).toEqual({ pre, post });
  });

  it("keeps the quoted spelling of a path decoding to a control character", () => {
    const line = 'diff --git "a/x\\ny" "b/x\\ny"';

    expect(parseDiffHeaderPaths(line)).toEqual({
      pre: '"a/x\\ny"',
      post: '"b/x\\ny"',
    });
  });

  it("keeps the quoted spelling of a path holding a direction control", () => {
    const line =
      'diff --git "a/x\\342\\200\\256sj.gnp" "b/x\\342\\200\\256sj.gnp"';

    expect(parseDiffHeaderPaths(line)?.post).toBe('"b/x\\342\\200\\256sj.gnp"');
  });

  it("keeps the quoted spelling of a path that decodes to a quoted shape", () => {
    expect(decodeGitPath('"\\"x\\""')).toBe('"\\"x\\""');
  });

  it("decodes right-to-left letters", () => {
    expect(decodeGitPath('"\\327\\251.md"')).toBe("\u05e9.md");
  });

  it("keeps the quoted spelling of bytes that are no UTF-8", () => {
    expect(decodeGitPath('"b/\\351.txt"')).toBe('"b/\\351.txt"');
  });

  it.each([
    "diff --git broken",
    "diff --git a/a b/a\r",
    'diff --git "a/unclosed b/x',
    "index 1..2 100644",
  ])("reads no paths from %j", (line) => {
    expect(parseDiffHeaderPaths(line)).toBeUndefined();
  });
});
