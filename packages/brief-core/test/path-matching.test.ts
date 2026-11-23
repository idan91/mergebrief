import { describe, expect, it } from "vitest";
import { matchesAnyGlob, matchesGlob } from "../src/path-matching";

const UNBOUNDED_STEPS = Number.MAX_SAFE_INTEGER;
const GLOB_ALPHABET = ["a", "/", "*", "?"];
const PATH_ALPHABET = ["a", "b", "/"];
const MAX_GLOB_LENGTH = 4;
const MAX_PATH_LENGTH = 5;
const FILTERED_PATH_COUNT = 5_000;
const LISTED_PATH_COUNT = 3_000;
const MISS_COUNT = LISTED_PATH_COUNT - 1;
const OVERRUN_MISS_COUNT = 99;
const SHARED_LIST_MISS_COUNT = 10;
const PADDED_NAME_LENGTH = 195;
const COSTLY_GLOB_LITERAL_LENGTH = 196;
const COSTLY_GLOB = `**/${"x".repeat(COSTLY_GLOB_LITERAL_LENGTH)}*`;
const LONG_PATH_LENGTH = 1_000;
const OVERRUN_STEPS = 1_000_000;
const FILTERED_SCAN_STEPS = 1_000;
const PREFIX_FIRST_STEPS = 50_000;
const LIST_ORDER_STEPS = 200;
const TWO_LIST_STEPS = 5_000_000;
const ONE_LIST_STEPS = 600_000;

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
    (_, index) => `${prefix}${String(index).padStart(PADDED_NAME_LENGTH, "0")}`,
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
    const paths = [
      ...makePaddedPaths("src/", OVERRUN_MISS_COUNT),
      `a/${"x".repeat(COSTLY_GLOB_LITERAL_LENGTH + 1)}`,
    ];

    expect(
      matchesAnyGlob([COSTLY_GLOB], [paths], OVERRUN_STEPS),
    ).toBeUndefined();
  });

  it("spends no steps on a path outside a glob's literal ends", () => {
    const prefixMisses = makePaddedPaths("other/", FILTERED_PATH_COUNT);
    const suffixMisses = makePaddedPaths("src/", FILTERED_PATH_COUNT);
    const paths = [...prefixMisses, ...suffixMisses];

    expect(
      matchesAnyGlob(
        ["src/payments/**"],
        [[...paths, "src/payments/a.ts"]],
        FILTERED_SCAN_STEPS,
      ),
    ).toBe(true);
    expect(
      matchesAnyGlob(
        ["**/*.snapshot.sql"],
        [[...paths, "db/1.snapshot.sql"]],
        FILTERED_SCAN_STEPS,
      ),
    ).toBe(true);
  });

  it("tries the glob with the longest literal prefix first", () => {
    const paths = [
      ...makePaddedPaths("src/", MISS_COUNT),
      "src/payments/charge.ts",
    ];

    expect(
      matchesAnyGlob(
        [COSTLY_GLOB, "src/payments/**"],
        [paths],
        PREFIX_FIRST_STEPS,
      ),
    ).toBe(true);
  });

  it("scans every glob against one list before the next", () => {
    const matched = matchesAnyGlob(
      ["**/x/**", "**/new.ts"],
      [["src/new.ts"], ["a".repeat(LONG_PATH_LENGTH)]],
      LIST_ORDER_STEPS,
    );

    expect(matched).toBe(true);
  });

  it("shares one budget across the lists", () => {
    const paths = makePaddedPaths("src/", SHARED_LIST_MISS_COUNT);

    expect(matchesAnyGlob([COSTLY_GLOB], [paths, paths], TWO_LIST_STEPS)).toBe(
      false,
    );
    expect(
      matchesAnyGlob([COSTLY_GLOB], [paths, paths], ONE_LIST_STEPS),
    ).toBeUndefined();
  });

  it("answers false for no globs or no paths", () => {
    expect(matchesAnyGlob([], [["a.ts"]], UNBOUNDED_STEPS)).toBe(false);
    expect(matchesAnyGlob(["**"], [[], []], UNBOUNDED_STEPS)).toBe(false);
  });
});
