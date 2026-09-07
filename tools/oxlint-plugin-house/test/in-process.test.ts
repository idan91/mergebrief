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
];

for (const { rule, bad, good, lines } of CASES) {
  const definition = plugin.rules[rule];
  if (definition === undefined) throw new Error(`plugin has no rule ${rule}`);
  tester.run(rule, definition as unknown as TesterRule, {
    valid: [readFixture(rule, good)],
    invalid: [
      {
        ...readFixture(rule, bad),
        errors: lines.map((line) => ({ messageId: "violation", line })),
      },
    ],
  });
}
