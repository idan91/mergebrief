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
import { DiffLineKinds, GrammarNames, type DiffLine } from "./types";

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
