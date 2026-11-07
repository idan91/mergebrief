import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { beforeAll, describe, expect, it } from "vitest";

import { SYNTAX_PALETTE, resolveClassId } from "./palette";
import { MERGEBRIEF_DARK, MERGEBRIEF_THEME_NAME } from "./theme";
import {
  tokenizeChunkRows,
  tokenizeSide,
  tokenizeStandaloneRows,
} from "./tokenizeChunk";
import { DiffLineKinds } from "types/diff-lines";
import {
  GrammarNames,
  type DiffLine,
  type GrammarName,
  type RowTokenLine,
} from "./types";

const MID_TAG_ROWS: DiffLine[] = [
  { kind: DiffLineKinds.HUNK, content: "@@ -1,3 +1,3 @@" },
  { kind: DiffLineKinds.DEL, content: '  title="old"' },
  { kind: DiffLineKinds.ADD, content: '  title="new"' },
  { kind: DiffLineKinds.CTX, content: "  disabled" },
  { kind: DiffLineKinds.CTX, content: "/>" },
];

let highlighter: HighlighterCore;

function resolvePaletteClassId(token: string): number {
  const index = SYNTAX_PALETTE.findIndex(
    (candidate) => candidate.token === token,
  );
  if (index < 0) {
    throw new Error(`no palette entry named ${token}`);
  }

  return index;
}

function readClassIdFor(
  lines: ReturnType<typeof tokenizeSide>,
  content: string,
): number {
  const token = lines
    .flat()
    .find((candidate) => candidate.text.trim() === content);
  if (token === undefined) {
    throw new Error(`no token for ${content}`);
  }

  return token.classId;
}

beforeAll(async () => {
  highlighter = await createHighlighterCore({
    themes: [MERGEBRIEF_DARK],
    langs: [
      import("shiki/langs/tsx.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/scss.mjs"),
      import("shiki/langs/css.mjs"),
    ],
    engine: createJavaScriptRegexEngine(),
  });
});

describe("tokenizeSide", () => {
  it("colours an attribute name on a side that opens mid-tag", () => {
    const lines = tokenizeSide(
      highlighter,
      '  title="new"\n  disabled\n/>',
      GrammarNames.TSX,
    );

    expect(readClassIdFor(lines, "title")).toBe(resolvePaletteClassId("tag"));
    expect(readClassIdFor(lines, "disabled")).toBe(
      resolvePaletteClassId("tag"),
    );
  });

  it("reads a mid-tag attribute as plain code without the prelude", () => {
    const lines = highlighter
      .codeToTokensBase('  title="new"\n  disabled\n/>', {
        lang: GrammarNames.TSX,
        theme: MERGEBRIEF_THEME_NAME,
      })
      .map((line) =>
        line.map((token) => ({
          text: token.content,
          classId: resolveClassId(token.color),
        })),
      );
    const token = lines
      .flat()
      .find((candidate) => candidate.text.includes("title"));

    expect(token?.classId).not.toBe(resolvePaletteClassId("tag"));
  });

  it("keeps code before an unclosed template as code", () => {
    const lines = tokenizeSide(
      highlighter,
      "const prompt = `Review this:\n  be terse",
      GrammarNames.TYPESCRIPT,
    );

    expect(readClassIdFor(lines, "const")).toBe(
      resolvePaletteClassId("keyword"),
    );
    expect(readClassIdFor(lines, "prompt")).not.toBe(
      resolvePaletteClassId("string"),
    );
  });

  it("emits one token line per input line", () => {
    const lines = tokenizeSide(
      highlighter,
      "const a = 1;\nconst b = 2;",
      GrammarNames.TYPESCRIPT,
    );

    expect(lines).toHaveLength(2);
  });

  it("keeps a block comment grey on a side that opens inside one", () => {
    const lines = tokenizeSide(
      highlighter,
      " * still commentary\n */",
      GrammarNames.TYPESCRIPT,
    );

    expect(readClassIdFor(lines, "* still commentary")).toBe(
      resolvePaletteClassId("comment"),
    );
  });
});

describe("tokenizeSide on css", () => {
  it("colours a property on a side that opens inside a rule", () => {
    const inside = tokenizeSide(
      highlighter,
      "    line-height: 1;\n  }",
      GrammarNames.SCSS,
    );
    const whole = tokenizeSide(
      highlighter,
      ".badge {\n  line-height: 1;\n}",
      GrammarNames.SCSS,
      true,
    );

    expect(readClassIdFor(inside, "line-height")).toBe(
      readClassIdFor(whole, "line-height"),
    );
    expect(readClassIdFor(inside, "line-height")).not.toBe(
      resolvePaletteClassId("text"),
    );
  });

  it("colours selectors on a css side that opens inside an at-rule", () => {
    const selectors = ["  .badge:hover,", "  .badge:focus-visible {"];
    const inside = tokenizeSide(
      highlighter,
      [...selectors, "    color: red;", "  }", "}"].join("\n"),
      GrammarNames.CSS,
    );
    const whole = tokenizeSide(
      highlighter,
      [...selectors, "    color: red;", "  }"].join("\n"),
      GrammarNames.CSS,
      true,
    );

    expect(readClassIdFor(inside, ".badge:focus-visible")).toBe(
      readClassIdFor(whole, ".badge:focus-visible"),
    );
    expect(readClassIdFor(inside, "color")).toBe(
      readClassIdFor(whole, "color"),
    );
  });

  it("colours selectors on a css side that opens on a comment", () => {
    const lines = ["  /* Focus ring */", "  .badge:hover {", "    color: red;"];
    const inside = tokenizeSide(
      highlighter,
      [...lines, "  }", "}"].join("\n"),
      GrammarNames.CSS,
    );
    const whole = tokenizeSide(
      highlighter,
      [...lines, "  }"].join("\n"),
      GrammarNames.CSS,
      true,
    );

    expect(readClassIdFor(inside, ".badge:hover")).toBe(
      readClassIdFor(whole, ".badge:hover"),
    );
    expect(readClassIdFor(inside, "color")).toBe(
      readClassIdFor(whole, "color"),
    );
  });

  it("colours values on a css side that opens on a comma-ended value", () => {
    const values = ["    opacity 160ms ease,", "    transform 160ms ease;"];
    const inside = tokenizeSide(
      highlighter,
      [...values, "  }"].join("\n"),
      GrammarNames.CSS,
    );
    const whole = tokenizeSide(
      highlighter,
      [".badge {", "  transition:", ...values, "  }"].join("\n"),
      GrammarNames.CSS,
      true,
    );

    expect(readClassIdFor(inside, "ease")).toBe(readClassIdFor(whole, "ease"));
  });

  it.each([GrammarNames.CSS, GrammarNames.SCSS])(
    "colours a %s rule after a side cut inside its comment",
    (grammar) => {
      const rest = ["   * legacy", "   */", "  color: red;", "}"];
      const inside = tokenizeSide(highlighter, rest.join("\n"), grammar);
      const whole = tokenizeSide(
        highlighter,
        [".badge {", "  /*", ...rest].join("\n"),
        grammar,
        true,
      );

      expect(readClassIdFor(inside, "* legacy")).toBe(
        readClassIdFor(whole, "* legacy"),
      );
      expect(readClassIdFor(inside, "color")).toBe(
        readClassIdFor(whole, "color"),
      );
      expect(readClassIdFor(inside, "red")).toBe(readClassIdFor(whole, "red"));
    },
  );
});

interface StylesheetSliceCase {
  name: string;
  grammar: GrammarName;
  source: readonly string[];
  start: number;
  length: number;
}

const KEYFRAMES_SOURCE = [
  "@keyframes spin {",
  "  from {",
  "    transform: rotate(0deg);",
  "  }",
  "  to {",
  "    transform: rotate(360deg);",
  "  }",
  "}",
];

const TRANSITION_SOURCE = [
  ".card {",
  "  color: red;",
  "  transition:",
  "    opacity 160ms ease,",
  "    transform 160ms ease;",
  "  will-change: transform;",
  "  cursor: pointer;",
  "}",
];

const STYLESHEET_SLICE_CASES: readonly StylesheetSliceCase[] = [
  {
    name: "global selector in an at-rule",
    grammar: GrammarNames.SCSS,
    source: [
      "@layer components {",
      '  :global(.main[data-focus-panel="open"]) .group {',
      "    translate: calc(-1 * var(--focus-shift)) 0;",
      "  }",
      "",
      "  /* stylelint-disable length-zero-no-unit */",
      '  :global(.main[data-focus-panel="open"]) .chunks article {',
      "    --chunk-head-reserve: max(0px, var(--focus-overlap));",
      "  }",
      "  /* stylelint-enable length-zero-no-unit */",
      "}",
    ],
    start: 6,
    length: 6,
  },
  ...[GrammarNames.CSS, GrammarNames.SCSS].flatMap((grammar) => [
    {
      name: "declaration whose value starts below it",
      grammar,
      source: TRANSITION_SOURCE,
      start: 3,
      length: 5,
    },
    {
      name: "value line cut before the rule closes",
      grammar,
      source: TRANSITION_SOURCE,
      start: 4,
      length: 4,
    },
    {
      name: "keyframe selector",
      grammar,
      source: KEYFRAMES_SOURCE,
      start: 5,
      length: 4,
    },
  ]),
  {
    name: "universal selector line",
    grammar: GrammarNames.CSS,
    source: ["/* reset */", "* {", "  box-sizing: border-box;", "}"],
    start: 2,
    length: 1,
  },
  {
    name: "cut inside a comment before a keyframe",
    grammar: GrammarNames.CSS,
    source: [
      "@keyframes spin {",
      "  /* half",
      "   * turn */",
      "  to {",
      "    transform: rotate(360deg);",
      "  }",
      "}",
    ],
    start: 3,
    length: 4,
  },
  {
    name: "semicolon in a selector's line comment",
    grammar: GrammarNames.SCSS,
    source: [
      ".list {",
      "  margin: 0;",
      "",
      "  .b, // legacy; drop later",
      "  .c {",
      "    margin: 0;",
      "  }",
      "}",
    ],
    start: 4,
    length: 5,
  },
  {
    name: "braces in a selector's line comment",
    grammar: GrammarNames.SCSS,
    source: [
      ".list {",
      "  margin: 0;",
      "",
      "  .b, // was .c { margin: 0 }",
      "  .c {",
      "    margin: 0;",
      "  }",
      "}",
    ],
    start: 4,
    length: 5,
  },
  {
    name: "unquoted url holding a double slash",
    grammar: GrammarNames.SCSS,
    source: [
      ".hero {",
      "  background:",
      "    url(http://x//a.png);",
      "  gap: 0;",
      "}",
    ],
    start: 3,
    length: 2,
  },
  {
    name: "brace in a declaration's line comment",
    grammar: GrammarNames.SCSS,
    source: [
      ".row {",
      "  color: red; // brand red; see tokens }",
      "  gap: 0;",
      "}",
    ],
    start: 2,
    length: 3,
  },
  ...[GrammarNames.CSS, GrammarNames.SCSS].flatMap((grammar) => [
    {
      name: "semicolon in a selector's block comment",
      grammar,
      source: [
        "@media (hover: hover) {",
        "  .x, /* trailing; { */",
        "  .y {",
        "    color: red;",
        "  }",
        "}",
      ],
      start: 2,
      length: 5,
    },
    {
      name: "string holding a semicolon and a brace",
      grammar,
      source: [
        ".quote {",
        "  color: red;",
        '  content: "; {";',
        "  quotes: '}' '{';",
        "}",
      ],
      start: 3,
      length: 3,
    },
  ]),
  {
    name: "at-rule selector wrapped at a combinator",
    grammar: GrammarNames.CSS,
    source: [
      "@media (hover: hover) {",
      '  .sidebar-group-header-button:not([aria-expanded="true"])',
      "    > .sidebar-group-header-icon {",
      "    opacity: 0.6;",
      "  }",
      "}",
    ],
    start: 2,
    length: 5,
  },
  {
    name: "at-rule list whose last selector wraps",
    grammar: GrammarNames.CSS,
    source: [
      "@media (hover: hover) {",
      "  .a,",
      "  .b-long",
      "    > .c {",
      "    opacity: 0.6;",
      "  }",
      "}",
    ],
    start: 2,
    length: 6,
  },
  {
    name: "function's arguments",
    grammar: GrammarNames.SCSS,
    source: [
      ".button {",
      "  background: color-mix(",
      "    in oklch,",
      "    var(--color-accent) 85%,",
      "    var(--color-background)",
      "  );",
      "  color: red;",
      "}",
    ],
    start: 3,
    length: 6,
  },
  {
    name: "selector's wrapped :is( list",
    grammar: GrammarNames.CSS,
    source: [
      ":root",
      "  :is(",
      '    .vp-doc div[class*="language-"] > pre,',
      "    .VPLocalSearchBox .result",
      "  ):focus-visible {",
      "  outline-offset: -2px;",
      "}",
    ],
    start: 4,
    length: 4,
  },
  {
    name: "declaration cut before its semicolon",
    grammar: GrammarNames.SCSS,
    source: [
      ".text {",
      "  background: linear-gradient(",
      "    to right,",
      "    transparent 0 1ch,",
      "    red 1ch",
      "  );",
      "}",
    ],
    start: 2,
    length: 3,
  },
  {
    name: "comment continuation with no closer",
    grammar: GrammarNames.CSS,
    source: [
      "/**",
      " * Colors: Palette",
      " *",
      " * The primitive colors used for accent colors.",
      ' * by functional colors such as "Text".',
      " */",
      ":root {",
      "  --x: 1;",
      "}",
    ],
    start: 2,
    length: 4,
  },
  {
    name: "selector that names its parent",
    grammar: GrammarNames.SCSS,
    source: [
      "@mixin when-story-stacks {",
      "  @media (width <= 1220px) {",
      "    :global(.main) & {",
      "      @content;",
      "    }",
      "  }",
      "}",
    ],
    start: 3,
    length: 4,
  },
  {
    name: "at-rule that closes its parent",
    grammar: GrammarNames.SCSS,
    source: [
      ".member {",
      "  &[aria-current] {",
      "    cursor: default;",
      "",
      "    @container scroll-state(stuck: bottom) {",
      "      box-shadow: var(--stack-current-edge);",
      "    }",
      "  }",
      "}",
    ],
    start: 5,
    length: 4,
  },
  {
    name: "nested rule before a parent declaration",
    grammar: GrammarNames.SCSS,
    source: [
      ".line {",
      "  > .code {",
      "    white-space: pre-wrap;",
      "  }",
      "",
      "  --row-hue: red;",
      "}",
    ],
    start: 2,
    length: 5,
  },
  {
    name: "value line led by a variable",
    grammar: GrammarNames.SCSS,
    source: [
      ".row {",
      "  grid-template-columns:",
      "    $rail $split-number minmax(0, 1fr)",
      "    $rail $split-number minmax(0, 1fr);",
      "  background: none;",
      "}",
    ],
    start: 3,
    length: 3,
  },
  {
    name: "brace inside a string",
    grammar: GrammarNames.CSS,
    source: [
      ".quote::before {",
      "  color: red;",
      '  content: "{";',
      "  margin: 0;",
      "}",
    ],
    start: 3,
    length: 2,
  },
];

function readInkClassIds(tokens: RowTokenLine): number[] {
  const classIds: number[] = [];
  for (const token of tokens) {
    for (const character of token.text) {
      if (character.trim() !== "") {
        classIds.push(token.classId);
      }
    }
  }

  return classIds;
}

describe("tokenizeChunkRows on a stylesheet slice", () => {
  it.each(STYLESHEET_SLICE_CASES)(
    "matches the whole file on $grammar $name",
    ({ grammar, source, start, length }) => {
      const lines = source.slice(start - 1, start - 1 + length);
      const rows = lines.map((content, offset) => ({
        kind: DiffLineKinds.CTX,
        content,
        oldLine: start + offset,
        newLine: start + offset,
      }));
      const sliced = tokenizeChunkRows(highlighter, rows, grammar);
      const whole = tokenizeSide(highlighter, source.join("\n"), grammar, true);

      const slicedInk = rows.map((_, offset) =>
        readInkClassIds(sliced.get(offset) ?? []),
      );
      const wholeInk = rows.map((_, offset) =>
        readInkClassIds(whole[start - 1 + offset] ?? []),
      );

      expect(slicedInk).toEqual(wholeInk);
    },
  );
});

describe("tokenizeChunkRows", () => {
  it("keys tokens by the diff row they came from", () => {
    const byRow = tokenizeChunkRows(
      highlighter,
      MID_TAG_ROWS,
      GrammarNames.TSX,
    );

    expect([...byRow.keys()].toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("keeps code after a line gap out of the comment opened before it", () => {
    const byRow = tokenizeChunkRows(
      highlighter,
      [
        { kind: DiffLineKinds.HUNK, content: "@@ -1,4 +1,3 @@" },
        { kind: DiffLineKinds.CTX, content: "/**", oldLine: 14, newLine: 13 },
        { kind: DiffLineKinds.DEL, content: " * old cap", oldLine: 15 },
        { kind: DiffLineKinds.ADD, content: " * new cap", newLine: 14 },
        {
          kind: DiffLineKinds.CTX,
          content: "  return true;",
          oldLine: 23,
          newLine: 22,
        },
      ],
      GrammarNames.TYPESCRIPT,
    );
    const afterGap = byRow.get(4) ?? [];
    const token = afterGap.find((candidate) => candidate.text === "true");

    expect(token?.classId).not.toBe(resolvePaletteClassId("comment"));
    expect(readClassIdFor([byRow.get(3) ?? []], "* new cap")).toBe(
      resolvePaletteClassId("comment"),
    );
  });

  it("rebuilds the added side so its attribute name is a tag", () => {
    const byRow = tokenizeChunkRows(
      highlighter,
      MID_TAG_ROWS,
      GrammarNames.TSX,
    );
    const added = byRow.get(2) ?? [];
    const token = added.find((candidate) => candidate.text.trim() === "title");

    expect(token?.classId).toBe(resolvePaletteClassId("tag"));
  });
});

describe("tokenizeStandaloneRows", () => {
  const SNIPPET_ROWS: DiffLine[] = [
    { kind: DiffLineKinds.ADD, content: 'const label = "ship";' },
    { kind: DiffLineKinds.ADD, content: "export function run() {}" },
  ];

  it("colours a keyword and a string in a tsx snippet", () => {
    const byRow = tokenizeStandaloneRows(
      highlighter,
      SNIPPET_ROWS,
      GrammarNames.TSX,
    );

    expect(readRowClassId(byRow, 0, "const")).toBe(
      resolvePaletteClassId("keyword"),
    );
    expect(readRowClassId(byRow, 0, '"ship"')).toBe(
      resolvePaletteClassId("string"),
    );
  });

  it("takes rows in order with nothing reconstructed", () => {
    const byRow = tokenizeStandaloneRows(
      highlighter,
      SNIPPET_ROWS,
      GrammarNames.TSX,
    );

    expect([...byRow.keys()].toSorted((a, b) => a - b)).toEqual([0, 1]);
  });

  it("leaves a hunk row untokenized", () => {
    const rows: DiffLine[] = [
      { kind: DiffLineKinds.HUNK, content: "@@ -1 +1 @@" },
      ...SNIPPET_ROWS,
    ];

    const byRow = tokenizeStandaloneRows(highlighter, rows, GrammarNames.TSX);

    expect(byRow.has(0)).toBe(false);
    expect(byRow.has(1)).toBe(true);
  });
});

function readRowClassId(
  byRow: ReturnType<typeof tokenizeStandaloneRows>,
  rowIndex: number,
  content: string,
): number {
  const tokens = byRow.get(rowIndex);
  if (tokens === undefined) {
    throw new Error(`no tokens for row ${rowIndex}`);
  }

  return readClassIdFor([tokens], content);
}
