import { describe, expect, it } from "vitest";
import { fileRangeQuerySchema } from "./schemas";
import { MAX_FILE_RANGE_LINES } from "contract";

const HEAD_SHA = `${"0".repeat(39)}a`;

function makeQuery(overrides: Record<string, string>): Record<string, string> {
  return {
    ref: HEAD_SHA,
    path: "src/app.ts",
    from: "1",
    to: "20",
    ...overrides,
  };
}

describe("fileRangeQuerySchema", () => {
  it("accepts a plain ref, path and in-range window", () => {
    const parsed = fileRangeQuerySchema.safeParse(makeQuery({}));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      ref: HEAD_SHA,
      path: "src/app.ts",
      from: 1,
      to: 20,
    });
  });

  const refusals: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ["a cross-repo owner:ref selector", { ref: "attacker:main" }],
    ["a branch name in place of a commit", { ref: "main" }],
    ["a short SHA", { ref: "abc1234" }],
    ["a traversing path segment", { path: "src/../../etc/passwd" }],
    ["a single-dot segment", { path: "src/./app.ts" }],
    ["an absolute path", { path: "/etc/passwd" }],
    ["an empty path segment", { path: "src//app.ts" }],
    ["a NUL byte in the path", { path: "src/app\u0000.ts" }],
    ["a newline in the path", { path: "src/app\n.ts" }],
    ["from past to", { from: "40", to: "20" }],
    ["a zero line number", { from: "0", to: "5" }],
    ["a non-numeric line", { from: "one", to: "5" }],
    [
      "a span over the cap",
      { from: "1", to: String(MAX_FILE_RANGE_LINES + 1) },
    ],
  ];

  it.each(refusals)("refuses %s", (_label, overrides) => {
    expect(fileRangeQuerySchema.safeParse(makeQuery(overrides)).success).toBe(
      false,
    );
  });

  const accepted: ReadonlyArray<readonly [string, string]> = [
    ["a bracketed route segment", "app/[slug]/page.tsx"],
    ["a non-ASCII filename", "src/caf\u00e9.ts"],
    ["braces, hash, semicolon and caret", "src/a{b}#c;d^e.ts"],
    ["a percent in the name", "src/100%.css"],
    ["a dotfile", ".github/workflows/ci.yml"],
  ];

  it.each(accepted)("accepts %s", (_label, path) => {
    expect(fileRangeQuerySchema.safeParse(makeQuery({ path })).success).toBe(
      true,
    );
  });

  it("accepts a span exactly at the cap", () => {
    const parsed = fileRangeQuerySchema.safeParse(
      makeQuery({ from: "1", to: String(MAX_FILE_RANGE_LINES) }),
    );
    expect(parsed.success).toBe(true);
  });
});
