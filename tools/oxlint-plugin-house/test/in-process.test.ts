import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "../src/index.mjs";
import { readFixture, readMarkedLines } from "./utils";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester();

// oxlint exports no `Rule` type; the tester's own parameter type stands in.
type TesterRule = Parameters<RuleTester["run"]>[1];

interface FixtureCase {
  readonly rule: string;
  /** The run's label when one rule has more than one fixture pair. */
  readonly name?: string;
  readonly bad: string;
  readonly good: string;
  readonly lines: readonly number[];
  readonly messageIds?: readonly string[];
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
    rule: "types-const-maps",
    bad: "bad.ts",
    good: "good.ts",
    lines: [1, 5, 7, 9, 11],
    messageIds: ["helper", "notMap", "helper", "notMap", "notMap"],
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
  {
    rule: "no-re-export",
    name: "no-re-export outside a barrel",
    bad: "bad.ts",
    good: "good.ts",
    lines: readMarkedLines("no-re-export", "bad.ts"),
  },
  {
    rule: "no-re-export",
    name: "no-re-export of an export assignment",
    bad: "bad-export-assignment.ts",
    good: "good-config/vite.config.ts",
    lines: readMarkedLines("no-re-export", "bad-export-assignment.ts"),
  },
  {
    rule: "no-re-export",
    name: "no-re-export inside a barrel",
    bad: "bad-barrel/index.ts",
    good: "good-barrel/index.ts",
    lines: readMarkedLines("no-re-export", "bad-barrel/index.ts"),
  },
];

for (const { rule, name, bad, good, lines, messageIds } of CASES) {
  const definition = plugin.rules[rule];
  if (definition === undefined) throw new Error(`plugin has no rule ${rule}`);
  tester.run(name ?? rule, definition as unknown as TesterRule, {
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
