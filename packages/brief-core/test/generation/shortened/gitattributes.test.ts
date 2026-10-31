import { describe, expect, it } from "vitest";
import { matchesGlob } from "../../../src/path-matching";
import {
  parseGitAttributes,
  readLinguistAttributesByPath,
} from "../../../src/generation/shortened/gitattributes";
import {
  GitAttributesRefusals,
  type GitAttributesRefusal,
  type LinguistRule,
} from "../../../src/generation/shortened/types";
import { readGitAttributeRules } from "./helpers";

/** The text size `parseGitAttributes` reads at most. */
const MAX_TEXT_CHARS = 65_536;
/** Far above a linear parse of one capped line, far below a quadratic one. */
const LINEAR_BUDGET_MS = 500;

function read(gitattributes: string, path: string) {
  const rules = readGitAttributeRules(gitattributes);
  return readLinguistAttributesByPath([path], rules).byPath.get(path);
}

function makeParsed(value: LinguistRule[]) {
  return { ok: true, value };
}

function makeRefused(error: GitAttributesRefusal) {
  return { ok: false, error };
}

/** One `.gitattributes` line whose glob is `length` characters of `*a`. */
function stubStarRule(length: number): string {
  return `/${"*a".repeat(length / 2)} linguist-generated`;
}

describe("parseGitAttributes", () => {
  it("keeps only rules that set or unset a linguist attribute", () => {
    const rules = readGitAttributeRules(
      [
        "# comment",
        "",
        "*.png binary",
        "dist/** linguist-generated",
        "vendor/** linguist-vendored=true -diff",
        "[attr]custom linguist-generated",
      ].join("\n"),
    );

    expect(rules).toEqual([
      { pattern: "dist/**", generated: true },
      { pattern: "vendor/**", vendored: true },
    ]);
  });

  it("reads unset, false and unspecified attributes as not set", () => {
    const rules = readGitAttributeRules(
      [
        "a.js -linguist-generated",
        "b.js linguist-generated=false",
        "c.js !linguist-vendored",
      ].join("\n"),
    );

    expect(rules).toEqual([
      { pattern: "**/a.js", generated: false },
      { pattern: "**/b.js", generated: false },
      { pattern: "**/c.js", vendored: false },
    ]);
  });

  it("reads a non-breaking space as part of the pattern, as git does", () => {
    expect(parseGitAttributes("dist/**\u00a0linguist-generated")).toEqual(
      makeParsed([]),
    );
  });

  it("splits on tabs and reads CRLF lines", () => {
    const rules = readGitAttributeRules("dist/**\tlinguist-generated\r\n");

    expect(rules).toEqual([{ pattern: "dist/**", generated: true }]);
  });

  it("reads a long run of blanks inside a line in linear time", () => {
    const blanks = " ".repeat(MAX_TEXT_CHARS - 64);
    const started = performance.now();
    parseGitAttributes(`a${blanks}b linguist-generated`);

    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it("skips directory patterns, which never match a file", () => {
    expect(parseGitAttributes("dist/ linguist-generated")).toEqual(
      makeParsed([]),
    );
  });

  it("refuses a file past the total pattern size cap", () => {
    const text = Array.from({ length: 40 }, () => stubStarRule(254)).join("\n");

    expect(parseGitAttributes(text)).toEqual(
      makeRefused(GitAttributesRefusals.OVER_RULE_BUDGET),
    );
  });

  it("refuses a file past the rule count cap", () => {
    const text = Array.from(
      { length: 300 },
      (_, index) => `f${index}.js linguist-generated`,
    ).join("\n");

    expect(parseGitAttributes(text)).toEqual(
      makeRefused(GitAttributesRefusals.OVER_RULE_BUDGET),
    );
  });

  it("refuses a file past the text size cap", () => {
    const text = `dist/** linguist-generated\n${"#".repeat(MAX_TEXT_CHARS)}`;

    expect(parseGitAttributes(text)).toEqual(
      makeRefused(GitAttributesRefusals.TOO_LARGE),
    );
  });

  it("reads an override past the rule count cap as no rule at all", () => {
    const fillers = Array.from(
      { length: 200 },
      (_, index) => `f${index}.js linguist-vendored`,
    );
    const text = [
      "generated/** linguist-generated",
      ...fillers,
      "generated/handwritten.ts -linguist-generated",
    ].join("\n");

    expect(read(text, "generated/handwritten.ts")?.generated).toBe(false);
    expect(read(text, "generated/client.ts")?.generated).toBe(false);
  });

  it.each([
    ["a quoted", '"generated/hand written.ts" -linguist-generated'],
    ["a macro", "[attr]handwritten -linguist-generated"],
    ["an overlong", `generated/${"a".repeat(256)}.ts -linguist-generated`],
    ["a bracket class", "generated/[a-z]*.ts -linguist-generated"],
    ["an escaped", String.raw`generated/\[id\].ts -linguist-generated`],
    ["an in-segment globstar", "generated/gen**.ts -linguist-generated"],
  ])("refuses a file beside %s unset it cannot apply", (_label, line) => {
    const text = `generated/** linguist-generated\n${line}`;

    expect(parseGitAttributes(text)).toEqual(
      makeRefused(GitAttributesRefusals.UNAPPLIED_UNSET),
    );
  });

  it("skips a set it cannot apply and keeps the other rules", () => {
    const text = [
      '"dist/a b.js" linguist-generated',
      "app/[id].ts linguist-generated",
      "src/gen**.ts linguist-generated",
      "dist/** linguist-vendored",
    ].join("\n");

    expect(parseGitAttributes(text)).toEqual(
      makeParsed([{ pattern: "dist/**", vendored: true }]),
    );
  });
});

describe("readLinguistAttributes", () => {
  it("matches a slashless pattern at any depth", () => {
    const rules = "*.min.js linguist-generated";

    expect(read(rules, "web/static/app.min.js")?.generated).toBe(true);
    expect(read(rules, "app.min.js")?.generated).toBe(true);
  });

  it("matches a slashless file name at the root and below", () => {
    const rules =
      "generated.ts linguist-generated\nbundle.js -linguist-vendored\n**/CHANGELOG.md linguist-generated";

    expect(read(rules, "generated.ts")?.generated).toBe(true);
    expect(read(rules, "src/generated.ts")?.generated).toBe(true);
    expect(read(rules, "CHANGELOG.md")?.generated).toBe(true);
    expect(read(rules, "XCHANGELOG.md")?.generated).toBe(false);
  });

  it("lets a root file's unset rule override an earlier broad one", () => {
    const rules = "*.js linguist-vendored\nbundle.js -linguist-vendored";

    expect(read(rules, "bundle.js")?.vendored).toBe(false);
    expect(read(rules, "app.js")?.vendored).toBe(true);
  });

  it("anchors a pattern with a slash at the repository root", () => {
    const rules =
      "/gen/*.ts linguist-generated\nsrc/api/*.ts linguist-generated";

    expect(read(rules, "gen/client.ts")?.generated).toBe(true);
    expect(read(rules, "pkg/gen/client.ts")?.generated).toBe(false);
    expect(read(rules, "src/api/routes.ts")?.generated).toBe(true);
    expect(read(rules, "lib/src/api/routes.ts")?.generated).toBe(false);
  });

  it("lets the last matching rule win per attribute", () => {
    const rules = [
      "dist/** linguist-generated",
      "dist/keep.js -linguist-generated",
      "dist/** linguist-vendored",
    ].join("\n");

    expect(read(rules, "dist/keep.js")).toEqual({
      generated: false,
      vendored: true,
    });
    expect(read(rules, "dist/out.js")).toEqual({
      generated: true,
      vendored: true,
    });
  });

  it("leaves paths past the match budget out and counts them", () => {
    const text = Array.from({ length: 16 }, () => stubStarRule(254)).join("\n");
    const rules = readGitAttributeRules(text);
    const paths = Array.from(
      { length: 20 },
      (_, index) => `${index}${"a/".repeat(499)}a`,
    );

    const { byPath, unresolvedPathCount } = readLinguistAttributesByPath(
      paths,
      rules,
    );

    expect(unresolvedPathCount).toBeGreaterThan(0);
    expect(byPath.size + unresolvedPathCount).toBe(paths.length);
    expect(byPath.has(paths[19] ?? "")).toBe(false);
  });

  it("leaves long paths out once rule scans pass their budget", () => {
    const rules = Array.from({ length: 200 }, (_, index) => ({
      pattern: `**/a/x${index}/**`,
      generated: true,
    }));
    const paths = Array.from(
      { length: 3000 },
      (_, index) => `${index}/${"a/".repeat(2000)}`,
    );

    const { unresolvedPathCount } = readLinguistAttributesByPath(paths, rules);

    expect(unresolvedPathCount).toBeGreaterThan(0);
  });

  it("matches directory rules exactly as the glob matcher does", () => {
    const patterns = ["**/gen/**", "**/a/gen", "vendor/**", "**/x.ts", "a/b"];
    const paths = [
      "gen/a.ts",
      "src/gen/a.ts",
      "src/xgen/a.ts",
      "src/gen",
      "a/gen",
      "z/a/gen",
      "za/gen",
      "vendor/lib/a.js",
      "vendored/a.js",
      "src/vendor/a.js",
      "x.ts",
      "src/x.ts",
      "src/ax.ts",
      "a/b",
      "a/b/c",
    ];

    for (const pattern of patterns) {
      const { byPath } = readLinguistAttributesByPath(paths, [
        { pattern, generated: true },
      ]);
      for (const path of paths) {
        expect(byPath.get(path)?.generated).toBe(matchesGlob(pattern, path));
      }
    }
  });

  it("resolves 3000 long paths under directory-anywhere rules", () => {
    const rules = readGitAttributeRules(
      [
        "vendor/** linguist-vendored",
        "**/__generated__/** linguist-generated",
        "**/__snapshots__/** linguist-generated",
        "**/generated/** linguist-generated",
        "**/third_party/** linguist-vendored",
        "*.pb.go linguist-generated",
      ].join("\n"),
    );
    const paths = Array.from({ length: 3000 }, (_, index) => {
      const folder = `packages/service-${index % 40}/src/${"nested/".repeat(20)}`;
      return index % 3 === 0
        ? `${folder}__generated__/graphql/types-${index}.ts`
        : `${folder}feature-${index}/component-${index}.tsx`;
    });

    const { byPath, unresolvedPathCount } = readLinguistAttributesByPath(
      paths,
      rules,
    );
    const generated = [...byPath.values()].filter((value) => value.generated);

    expect(unresolvedPathCount).toBe(0);
    expect(byPath.size).toBe(3000);
    expect(generated).toHaveLength(1000);
  });

  it("reads a file no rule names as neither", () => {
    expect(read("dist/** linguist-generated", "src/a.ts")).toEqual({
      generated: false,
      vendored: false,
    });
  });
});
