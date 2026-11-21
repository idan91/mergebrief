import { describe, expect, it } from "vitest";
import { matchesAnyGlob, matchesGlob } from "../src/path-matching";

const UNBOUNDED_STEPS = Number.MAX_SAFE_INTEGER;
const GLOB_ALPHABET = ["a", "/", "*", "?"];
const PATH_ALPHABET = ["a", "b", "/"];
const MAX_GLOB_LENGTH = 4;
const MAX_PATH_LENGTH = 5;
const FILTERED_PATH_COUNT = 5_000;

function listWords(alphabet: readonly string[], maxLength: number): string[] {
  const words = [""];
  let frontier = [""];
  for (let length = 1; length <= maxLength; length++) {
    frontier = frontier.flatMap((word) =>
      alphabet.map((letter) => word + letter),
    );
    words.push(...frontier);
  }
  return words;
}

function makePaddedPaths(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index).padStart(195, "0")}`,
  );
}

describe("matchesAnyGlob", () => {
  it.each([
    ["src/**", "src/a/b.ts"],
    ["src/**", "other/x.ts"],
    ["**/*.sql", "db/migrations/0001.sql"],
    ["**/*.sql", "0001.sql"],
    ["**/package.json", "package.json"],
    ["**/package.json", "apps/web/package.json.bak"],
    ["*.md", "docs/README.md"],
    ["a?c/x.ts", "a/c/x.ts"],
    ["src/**/fixtures/**", "src/notfixtures/a.json"],
    ["[ab].ts", "[ab].ts"],
    ["{a,b}/**", "{a,b}/x.ts"],
    ["!src/**", "!src/x.ts"],
    ["a\\b/*", "a\\b/c"],
    ["exact/path.ts", "exact/path.ts"],
    ["**", ""],
  ])("reads %s against %s as matchesGlob does", (glob, path) => {
    const matched = matchesAnyGlob([glob], [[path]], UNBOUNDED_STEPS);

    expect(matched).toBe(matchesGlob(glob, path));
  });

  it("agrees with matchesGlob on every short glob and path", () => {
    const paths = listWords(PATH_ALPHABET, MAX_PATH_LENGTH);
    const disagreements = listWords(GLOB_ALPHABET, MAX_GLOB_LENGTH).flatMap(
      (glob) =>
        paths
          .filter(
            (path) =>
              matchesAnyGlob([glob], [[path]], UNBOUNDED_STEPS) !==
              matchesGlob(glob, path),
          )
          .map((path) => `${glob} vs ${path}`),
    );

    expect(disagreements).toEqual([]);
  });

  it("is undefined once the scan passes its steps", () => {
    const glob = `**/${"x".repeat(196)}*`;
    const paths = [...makePaddedPaths("src/", 99), `a/${"x".repeat(197)}`];

    expect(matchesAnyGlob([glob], [paths], 1_000_000)).toBeUndefined();
  });

  it("spends no steps on a path outside a glob's literal ends", () => {
    const prefixMisses = makePaddedPaths("other/", FILTERED_PATH_COUNT);
    const suffixMisses = makePaddedPaths("src/", FILTERED_PATH_COUNT);
    const paths = [...prefixMisses, ...suffixMisses];

    expect(
      matchesAnyGlob(
        ["src/payments/**"],
        [[...paths, "src/payments/a.ts"]],
        1_000,
      ),
    ).toBe(true);
    expect(
      matchesAnyGlob(
        ["**/*.snapshot.sql"],
        [[...paths, "db/1.snapshot.sql"]],
        1_000,
      ),
    ).toBe(true);
  });

  it("tries the glob with the longest literal prefix first", () => {
    const glob = `**/${"x".repeat(196)}*`;
    const paths = [...makePaddedPaths("src/", 2_999), "src/payments/charge.ts"];

    expect(matchesAnyGlob([glob, "src/payments/**"], [paths], 50_000)).toBe(
      true,
    );
  });

  it("scans every glob against one list before the next", () => {
    const matched = matchesAnyGlob(
      ["**/x/**", "**/new.ts"],
      [["src/new.ts"], ["a".repeat(1_000)]],
      200,
    );

    expect(matched).toBe(true);
  });

  it("shares one budget across the lists", () => {
    const glob = `**/${"x".repeat(196)}*`;
    const paths = makePaddedPaths("src/", 10);

    expect(matchesAnyGlob([glob], [paths, paths], 5_000_000)).toBe(false);
    expect(matchesAnyGlob([glob], [paths, paths], 600_000)).toBeUndefined();
  });

  it("answers false for no globs or no paths", () => {
    expect(matchesAnyGlob([], [["a.ts"]], UNBOUNDED_STEPS)).toBe(false);
    expect(matchesAnyGlob(["**"], [[], []], UNBOUNDED_STEPS)).toBe(false);
  });
});
