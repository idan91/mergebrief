import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "../src/index.mjs";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester();

// oxlint exports no `Rule` type; the tester's own parameter type stands in.
type TesterRule = Parameters<RuleTester["run"]>[1];

interface FixtureCase {
  readonly rule: string;
  readonly bad: string;
  readonly good: string;
  readonly lines: readonly number[];
  readonly messageIds?: readonly string[];
}

function readFixture(
  rule: string,
  file: string,
): { code: string; filename: string } {
  const filename = join(FIXTURES_DIR, rule, file);
  return { code: readFileSync(filename, "utf8"), filename };
}

const CASES: readonly FixtureCase[] = [
  { rule: "no-enum", bad: "bad.ts", good: "good.ts", lines: [1, 5] },
  {
    rule: "extensionless-import",
    bad: "bad.ts",
    good: "good.ts",
    lines: [1, 2, 3, 4, 5, 6, 7],
  },
  { rule: "no-raw-button", bad: "bad.tsx", good: "good.tsx", lines: [4, 5] },
  { rule: "no-blank-target", bad: "bad.tsx", good: "good.tsx", lines: [3] },
  {
    rule: "no-conditional-spread",
    bad: "bad.ts",
    good: "good.ts",
    lines: [5, 6, 7, 8],
  },
  {
    rule: "test-title",
    bad: "bad.ts",
    good: "good.ts",
    lines: [3, 4, 5, 6, 7, 8, 9],
    messageIds: [
      "tooLong",
      "parenthetical",
      "tooLong",
      "parenthetical",
      "parenthetical",
      "parenthetical",
      "parenthetical",
    ],
  },
  {
    rule: "no-render-function",
    bad: "bad.tsx",
    good: "good.tsx",
    lines: [2, 4],
  },
  {
    rule: "no-hand-built-plural",
    bad: "bad.ts",
    good: "good.ts",
    lines: [2, 3],
  },
  {
    rule: "no-process-env",
    bad: "bad.ts",
    good: "good.ts",
    lines: [1, 2, 4, 5, 6, 7, 8, 9, 10, 11],
    messageIds: [
      "import",
      "import",
      "member",
      "member",
      "member",
      "member",
      "member",
      "member",
      "member",
      "member",
    ],
  },
  {
    rule: "comment-run",
    bad: "bad.ts",
    good: "good.ts",
    lines: [1, 8],
    messageIds: ["run", "run"],
  },
  {
    rule: "comment-density",
    bad: "bad.ts",
    good: "good.ts",
    lines: [5],
    messageIds: ["dense"],
  },
  {
    rule: "no-em-dash",
    bad: "bad.ts",
    good: "good.ts",
    lines: [3, 6, 9],
    messageIds: ["comment", "comment", "title"],
  },
];

for (const { rule, bad, good, lines, messageIds } of CASES) {
  const definition = plugin.rules[rule];
  if (definition === undefined) throw new Error(`plugin has no rule ${rule}`);
  tester.run(rule, definition as unknown as TesterRule, {
    valid: [readFixture(rule, good)],
    invalid: [
      {
        ...readFixture(rule, bad),
        errors: lines.map((line, index) => ({
          messageId: messageIds?.[index] ?? "violation",
          line,
        })),
      },
    ],
  });
}
