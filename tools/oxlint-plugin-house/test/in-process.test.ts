import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "../src/index.mjs";
import { readFixture, readMarkedLines } from "./utils";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester();

// oxlint exports no `Rule` type; the tester's own parameter type stands in.
type TesterRule = Parameters<RuleTester["run"]>[1];

type TesterCases = Parameters<RuleTester["run"]>[2];
type ValidCase = Exclude<TesterCases["valid"][number], string>;
type InvalidCase = TesterCases["invalid"][number];
type TesterOptions = NonNullable<ValidCase["options"]>;

interface FixtureCase {
  readonly rule: string;
  /** The run's label when one rule has more than one fixture pair. */
  readonly name?: string;
  readonly bad: string;
  readonly good: string;
  /** Further fixtures the rule must pass, such as a `.tsx` barrel. */
  readonly alsoGood?: readonly string[];
  /** Strings outside the rule's reach (ignored callees, attributes, keys), kept out of `good`. */
  readonly ignored?: string;
  readonly lines: readonly number[];
  readonly messageIds?: readonly string[];
  readonly options?: TesterOptions;
}

const SHOUT_CASE_OPTIONS: TesterOptions = [
  {
    ignoreKeys: ["name"],
    ignoreCallees: ["Error", "logger\\..*", "startsWith"],
    ignoreAttributes: ["className"],
  },
];

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
    rule: "no-conditional-spread",
    name: "no-conditional-spread on a JSX element",
    bad: "bad.tsx",
    good: "good.tsx",
    lines: [5, 6, 7],
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
    alsoGood: ["good-barrel-tsx/index.tsx"],
    lines: readMarkedLines("no-re-export", "bad-barrel/index.ts"),
  },
  {
    rule: "no-shout-case-copy",
    name: "no-shout-case-copy in code",
    bad: "bad.ts",
    good: "good.ts",
    ignored: "ignored.ts",
    lines: readMarkedLines("no-shout-case-copy", "bad.ts"),
    options: SHOUT_CASE_OPTIONS,
  },
  {
    rule: "no-shout-case-copy",
    name: "no-shout-case-copy in JSX",
    bad: "bad.tsx",
    good: "good.tsx",
    ignored: "ignored.tsx",
    lines: readMarkedLines("no-shout-case-copy", "bad.tsx"),
    options: SHOUT_CASE_OPTIONS,
  },
  {
    rule: "no-file-named-after-folder",
    name: "no-file-named-after-folder on a component",
    bad: "bad-component/Menu/Menu.tsx",
    good: "good-component/Menu/index.tsx",
    alsoGood: [
      "good-component-test/Button/Button.test.tsx",
      "good-hook-test/useViewportShape/useViewportShape.test.tsx",
    ],
    lines: [1],
  },
  {
    rule: "no-file-named-after-folder",
    name: "no-file-named-after-folder on a domain file",
    bad: "bad-domain/tenant/tenant.ts",
    good: "good-domain/tenant/index.ts",
    alsoGood: [
      "good-concern-hook/reading/useReading.ts",
      "good-concern-hook/mark-ready/useMarkReady.ts",
    ],
    lines: [1],
  },
  {
    rule: "no-file-named-after-folder",
    name: "no-file-named-after-folder across casings",
    bad: "bad-casing/mark-ready/markReady.ts",
    good: "good-concern-hook/mark-ready/useMarkReady.ts",
    lines: [1],
  },
  {
    rule: "no-file-named-after-folder",
    name: "no-file-named-after-folder on a test outside a component",
    bad: "bad-test/tenant/tenant.test.ts",
    good: "good-test/tenant/index.test.ts",
    alsoGood: ["good-task-tests/test/tracing/sampler.test.ts"],
    lines: [1],
  },
  {
    rule: "no-file-named-after-folder",
    name: "no-file-named-after-folder on a hook folder entry",
    bad: "bad-hook-folder/useViewportShape/useViewportShape.ts",
    good: "good-hook-folder/useViewportShape/index.ts",
    lines: [1],
  },
];

for (const {
  rule,
  name,
  bad,
  good,
  alsoGood = [],
  ignored,
  lines,
  messageIds,
  options,
} of CASES) {
  const definition = plugin.rules[rule];
  if (definition === undefined) {
    throw new Error(`plugin has no rule ${rule}`);
  }
  const valid: ValidCase[] = [good, ...alsoGood].map((file) => ({
    ...readFixture(rule, file),
  }));
  if (ignored !== undefined) {
    valid.push({ ...readFixture(rule, ignored) });
  }
  const invalid: InvalidCase = {
    ...readFixture(rule, bad),
    errors: lines.map((line, index) => ({
      messageId: messageIds?.[index] ?? "violation",
      line,
    })),
  };
  if (options !== undefined) {
    for (const validCase of valid) {
      validCase.options = options;
    }
    invalid.options = options;
  }
  tester.run(name ?? rule, definition as unknown as TesterRule, {
    valid,
    invalid: [invalid],
  });
}
