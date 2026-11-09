import { describe, expect, it } from "vitest";

import { derivePrelude } from "./prelude";
import {
  GrammarNames,
  Preludes,
  type DerivedPrelude,
  type GrammarName,
} from "./types";

describe("derivePrelude", () => {
  it("opens a block comment when a closer precedes any opener", () => {
    const text = [
      "* the body of a JSDoc block",
      "*/",
      "export const a = 1;",
    ].join("\n");

    expect(derivePrelude(text, GrammarNames.TSX)).toBe("/*");
  });

  it("leaves balanced code alone", () => {
    const text = ["/* a whole comment */", "const a = `done`;"].join("\n");

    expect(derivePrelude(text, GrammarNames.TYPESCRIPT)).toBeUndefined();
  });

  it("opens a tag when the first line of a tsx side is an attribute", () => {
    const text = ["  onSelect={handleSelect}", '  label="Open"', "/>"].join(
      "\n",
    );

    expect(derivePrelude(text, GrammarNames.TSX)).toBe("<Prelude");
  });

  it("opens a tag for a jsx side whose first line is a lone slash close", () => {
    const text = ["  />", "</section>"].join("\n");

    expect(derivePrelude(text, GrammarNames.JSX)).toBe("<Prelude");
  });

  it("skips blank lines when picking the first line of a tsx side", () => {
    const text = ["", "   ", '  title="Files"', "/>"].join("\n");

    expect(derivePrelude(text, GrammarNames.TSX)).toBe("<Prelude");
  });

  it("leaves a tsx side opening inside an attribute value alone", () => {
    const text = ['    ? "a"', '    : "b"', "  }"].join("\n");

    expect(derivePrelude(text, GrammarNames.TSX)).toBeUndefined();
  });

  it("leaves a tsx side opening inside a call argument alone", () => {
    const text = ["  navigate({", '    to: "/briefs",', "  })"].join("\n");

    expect(derivePrelude(text, GrammarNames.TSX)).toBeUndefined();
  });

  it("never opens a tag for a grammar without JSX", () => {
    const text = ['  name="value"', "/>"].join("\n");

    expect(derivePrelude(text, GrammarNames.TYPESCRIPT)).toBeUndefined();
  });

  it("returns no prelude for an empty side", () => {
    expect(derivePrelude("", GrammarNames.TSX)).toBeUndefined();
  });
});

const DOC_BLOCK_GRAMMARS: GrammarName[] = [
  GrammarNames.C,
  GrammarNames.CPP,
  GrammarNames.CSHARP,
  GrammarNames.GO,
  GrammarNames.JAVA,
  GrammarNames.KOTLIN,
  GrammarNames.PHP,
  GrammarNames.RUST,
  GrammarNames.SWIFT,
];

describe("derivePrelude on a side opening inside a doc block", () => {
  it.each(DOC_BLOCK_GRAMMARS)("opens a block comment for %s", (grammar) => {
    const text = [" * the body of a doc block", " */", "int a = 1;"].join("\n");

    expect(derivePrelude(text, grammar)).toBe(Preludes.BLOCK_COMMENT);
  });
});

const NEXT_AT_RULE = ["", "@media (width <= 760px) {"];

interface SharedRuleCase {
  name: string;
  lines: readonly string[];
  css: DerivedPrelude;
  scss: DerivedPrelude;
}

interface ScssRuleCase {
  name: string;
  lines: readonly string[];
  scss: DerivedPrelude;
}

interface RuleCase {
  name: string;
  lines: readonly string[];
  grammar: GrammarName;
  expected: DerivedPrelude;
}

const SHARED_RULE_CASES: readonly SharedRuleCase[] = [
  {
    name: "a selector line",
    lines: [".badge {", "  border: 0;", "}"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a declaration",
    lines: ["  border: 0;", "  color: var(--color-text-2);"],
    css: Preludes.OPEN_RULE,
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a custom property",
    lines: ["--x: 1;", "}"],
    css: Preludes.OPEN_RULE,
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a custom property with digits",
    lines: ["  --gray-950: oklch(20% 0.01 250);", "  --gray-900: x;"],
    css: Preludes.OPEN_RULE,
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a declaration with a trailing comment",
    lines: ["  color: red; /* the brand red */", "  gap: 0;"],
    css: Preludes.OPEN_RULE,
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a leading comment",
    lines: ["  /* Focus ring */", "  outline: 0;"],
    css: Preludes.OPEN_RULE,
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a multi-line value",
    lines: [
      "    transform: translate(",
      "      0,",
      "      1px",
      "    );",
      "  }",
    ],
    css: Preludes.OPEN_RULE,
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a top-level one-line rule",
    lines: [".badge { color: red; }", ".chip {", "  gap: 0;", "}"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a brace inside a comment",
    lines: [".badge {", "  color: red; /* } */", "}"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a selector in an at-rule",
    lines: ["  .badge:hover {", "    color: red;", "  }", "}"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a type selector with a pseudo-class in an at-rule",
    lines: ["  a:hover {", "    color: red;", "  }", "}"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a comment then a selector in an at-rule",
    lines: [
      "  /* Focus ring */",
      "  .badge:hover {",
      "    color: red;",
      "  }",
      "}",
      ...NEXT_AT_RULE,
    ],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a multi-line comment then a selector in an at-rule",
    lines: [
      "  /* Focus",
      "     ring */",
      "  .badge {",
      "    color: red;",
      "  }",
      "}",
      ...NEXT_AT_RULE,
    ],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a one-line rule in an at-rule",
    lines: [
      "  .badge { color: red; }",
      "  .chip {",
      "    color: red;",
      "  }",
      "}",
      ...NEXT_AT_RULE,
    ],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a selector list",
    lines: [".badge:hover,", ".badge:focus-visible {", "  color: red;", "}"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a selector list in an at-rule",
    lines: [
      "  .badge:hover,",
      "  .badge:focus-visible {",
      "    color: red;",
      "  }",
      "}",
    ],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a selector with a brace below it in an at-rule",
    lines: ["  .a", "  {", "    color: red;", "  }", "}"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a selector list with a brace below it in an at-rule",
    lines: ["  .a,", "  .b", "  {", "    color: red;", "  }", "}"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a comma-ended value list",
    lines: ["    opacity 160ms ease,", "    transform 160ms ease;", "  }"],
    css: Preludes.OPEN_VALUE,
    scss: Preludes.OPEN_VALUE,
  },
  {
    name: "a longer comma-ended value list",
    lines: [
      "    color 160ms ease,",
      "    opacity 160ms ease,",
      "    transform 160ms ease;",
      "  }",
    ],
    css: Preludes.OPEN_VALUE,
    scss: Preludes.OPEN_VALUE,
  },
  {
    name: "a declaration whose value starts below it",
    lines: [
      "  transition:",
      "    opacity 160ms ease,",
      "    transform 160ms ease;",
      "  will-change: transform;",
      "  cursor: pointer;",
    ],
    css: Preludes.OPEN_RULE,
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a value line with no closer",
    lines: [
      "    opacity 160ms ease,",
      "    transform 160ms ease;",
      "  will-change: transform;",
      "  cursor: pointer;",
    ],
    css: Preludes.OPEN_VALUE,
    scss: Preludes.OPEN_VALUE,
  },
  {
    name: "a selector wrapped at a combinator in an at-rule",
    lines: [
      '  .sidebar-group-header-button:not([aria-expanded="true"])',
      "    > .sidebar-group-header-icon {",
      "    opacity: 0.6;",
      "  }",
      "}",
    ],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a list whose last selector wraps in an at-rule",
    lines: [
      "  .a,",
      "  .b-long",
      "    > .c {",
      "    opacity: 0.6;",
      "  }",
      "}",
    ],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a global selector in an at-rule",
    lines: [
      "  /* stylelint-disable length-zero-no-unit */",
      '  :global(.main[data-focus-panel="open"]) .chunks article {',
      "    --chunk-head-reserve: max(0px, var(--focus-overlap));",
      "  }",
      "  /* stylelint-enable length-zero-no-unit */",
      "}",
    ],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a function's arguments",
    lines: [
      "    in oklch,",
      "    var(--color-accent) 85%,",
      "    var(--color-background)",
      "  );",
      "  color: red;",
    ],
    css: Preludes.OPEN_ARGUMENTS,
    scss: Preludes.OPEN_ARGUMENTS,
  },
  {
    name: "a closing paren with no statement end",
    lines: ["    ),", '  .code[data-view="split"]'],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a selector's wrapped is list",
    lines: [
      "    .VPLocalSearchBox .result",
      "  ):focus-visible {",
      "  outline-offset: -2px;",
      "}",
    ],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a declaration cut before its semicolon",
    lines: [
      "  background: linear-gradient(",
      "    to right,",
      "    transparent",
    ],
    css: Preludes.OPEN_RULE,
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a selector list cut before its brace",
    lines: [".badge:hover,", ".badge:focus-visible,"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a brace inside a string",
    lines: ['  content: "{";', "  margin: 0;"],
    css: Preludes.OPEN_RULE,
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a keyframe selector",
    lines: ["  to {", "    transform: rotate(360deg);", "  }", "}"],
    css: Preludes.OPEN_KEYFRAMES,
    scss: Preludes.OPEN_KEYFRAMES,
  },
  {
    name: "a keyframe selector list",
    lines: ["  0%,", "  50% {", "    opacity: 0;", "  }"],
    css: Preludes.OPEN_KEYFRAMES,
    scss: Preludes.OPEN_KEYFRAMES,
  },
  {
    name: "a comment continuation with no closer",
    lines: [" * Colors: Palette", " *", " * The primitive colors."],
    css: Preludes.BLOCK_COMMENT,
    scss: Preludes.BLOCK_COMMENT,
  },
  {
    name: "a universal selector",
    lines: ["* {", "  box-sizing: border-box;", "}"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a universal selector line",
    lines: ["* {"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a one-line universal rule",
    lines: ["* { box-sizing: border-box; }"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a one-line universal sibling rule",
    lines: ["* + * { margin-block-start: 1em }"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "universal combinator selectors cut before their brace",
    lines: ["* > p,", "* ~ p,"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "universal pseudo selectors cut before their brace",
    lines: ["*::before,", "*:focus-visible,"],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a comment continuation holding a brace mid-line",
    lines: [" * Wrap { in quotes", " * inside content."],
    css: Preludes.BLOCK_COMMENT,
    scss: Preludes.BLOCK_COMMENT,
  },
  {
    name: "a comment continuation ending in an example rule",
    lines: [" * Example: .badge { color: red; }", " * and more."],
    css: Preludes.BLOCK_COMMENT,
    scss: Preludes.BLOCK_COMMENT,
  },
  {
    name: "a comment continuation opening with a link tag",
    lines: [" * {@link tokens} names the colours."],
    css: Preludes.BLOCK_COMMENT,
    scss: Preludes.BLOCK_COMMENT,
  },
  {
    name: "a side cut inside a comment before a keyframe",
    lines: ["   * turn */", "  to {", "    transform: rotate(360deg);", "  }"],
    css: Preludes.OPEN_KEYFRAMES_COMMENT,
    scss: Preludes.OPEN_KEYFRAMES_COMMENT,
  },
  {
    name: "a side cut inside a comment in a rule",
    lines: ["   * legacy", "   */", "  color: red;", "}"],
    css: Preludes.OPEN_RULE_COMMENT,
    scss: Preludes.OPEN_RULE_COMMENT,
  },
  {
    name: "a side cut inside a comment before a selector",
    lines: ["   * legacy", "   */", ".badge {", "  color: red;", "}"],
    css: Preludes.BLOCK_COMMENT,
    scss: Preludes.BLOCK_COMMENT,
  },
  {
    name: "a side cut inside a comment in an at-rule",
    lines: [
      "   * legacy",
      "   */",
      "  .badge {",
      "    color: red;",
      "  }",
      "}",
    ],
    css: Preludes.BLOCK_COMMENT,
    scss: Preludes.BLOCK_COMMENT,
  },
  {
    name: "a side cut inside a comment that ends the side",
    lines: ["   * still a note", "   */"],
    css: Preludes.BLOCK_COMMENT,
    scss: Preludes.BLOCK_COMMENT,
  },
  {
    name: "a side that starts on a closing brace",
    lines: ["}", "", ".badge {", "  color: red;", "}"],
    css: Preludes.OPEN_RULE,
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a blank side",
    lines: ["", "   "],
    css: undefined,
    scss: undefined,
  },
  {
    name: "a comment-only side",
    lines: ["  /* only a note */"],
    css: undefined,
    scss: undefined,
  },
];

const SCSS_RULE_CASES: readonly ScssRuleCase[] = [
  {
    name: "a declaration with a trailing line comment",
    lines: ["  color: red; // the brand red", "  gap: 0;"],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a leading line comment",
    lines: ["  // Focus ring", "  outline: 0;"],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a nested parent selector",
    lines: ["  &:hover {", "    color: red;", "  }", "}"],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a top-level variable",
    lines: ["$gap: 4px;", ".badge {", "  gap: $gap;", "}"],
    scss: undefined,
  },
  {
    name: "an indented variable",
    lines: ["  $gap: 4px;", "  color: red;"],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a top-level include",
    lines: ["@include reset;", ".badge {", "  gap: 0;", "}"],
    scss: undefined,
  },
  {
    name: "an include",
    lines: ["  @include focus-ring;", "  color: red;"],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "an include with arguments",
    lines: ["  @include truncate(2);", "  color: red;"],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "an extend",
    lines: ["  @extend %chip;", "  color: red;"],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "an interpolated property",
    lines: ["  #{$side}: 0;", "  color: red;"],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a selector that names its parent",
    lines: ["    :global(.main) & {", "      @content;", "    }", "  }"],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "an at-rule that closes its parent",
    lines: [
      "    @container scroll-state(stuck: bottom) {",
      "      box-shadow: none;",
      "    }",
      "  }",
    ],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a nested rule before a parent declaration",
    lines: [
      "  > .code {",
      "    white-space: pre-wrap;",
      "  }",
      "",
      "  --row-hue: red;",
    ],
    scss: Preludes.OPEN_RULE,
  },
  {
    name: "a value line led by a variable",
    lines: [
      "    $rail $split-number minmax(0, 1fr)",
      "    $rail $split-number minmax(0, 1fr);",
      "  background: none;",
    ],
    scss: Preludes.OPEN_VALUE,
  },
  {
    name: "a top-level use",
    lines: ['@use "functions";', ".badge {", "  gap: 0;", "}"],
    scss: undefined,
  },
  {
    name: "a line comment holding a semicolon after a selector",
    lines: [
      "  .b, // legacy; drop later",
      "  .c {",
      "    margin: 0;",
      "  }",
      "}",
    ],
    scss: undefined,
  },
  {
    name: "an unquoted url holding a double slash",
    lines: ["    url(http://x//a.png);", "  gap: 0;"],
    scss: Preludes.OPEN_VALUE,
  },
  {
    name: "an uppercase unquoted url holding a double slash",
    lines: ["    URL(http://x//a.png);", "  gap: 0;"],
    scss: Preludes.OPEN_VALUE,
  },
  {
    name: "an interpolated selector",
    lines: ["#{$root}__label {", "  color: red;", "}"],
    scss: undefined,
  },
];

const RULE_CASES: readonly RuleCase[] = [
  ...SHARED_RULE_CASES.flatMap(({ name, lines, css, scss }) => [
    { name, lines, grammar: GrammarNames.CSS, expected: css },
    { name, lines, grammar: GrammarNames.SCSS, expected: scss },
  ]),
  ...SCSS_RULE_CASES.map(({ name, lines, scss }) => ({
    name,
    lines,
    grammar: GrammarNames.SCSS,
    expected: scss,
  })),
];

describe("derivePrelude on a css or scss side", () => {
  it.each(RULE_CASES)("reads $grammar $name", (row) => {
    expect(derivePrelude(row.lines.join("\n"), row.grammar)).toBe(row.expected);
  });
});

describe("derivePrelude outside css", () => {
  it("never opens a rule for a grammar without css", () => {
    const text = ["  border: 0;", "}"].join("\n");

    expect(derivePrelude(text, GrammarNames.TYPESCRIPT)).toBeUndefined();
  });
});
