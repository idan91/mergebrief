import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { beforeAll, describe, expect, it } from "vitest";

import { SYNTAX_PALETTE, resolveClassId } from "./palette";
import { MERGEBRIEF_DARK, MERGEBRIEF_THEME_NAME } from "./theme";
import { tokenizeChunkRows, tokenizeSide } from "./tokenizeChunk";
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
  if (index < 0) throw new Error(`no palette entry named ${token}`);

  return index;
}

function readClassIdFor(
  lines: ReturnType<typeof tokenizeSide>,
  content: string,
): number {
  const token = lines
    .flat()
    .find((candidate) => candidate.text.trim() === content);
  if (token === undefined) throw new Error(`no token for ${content}`);

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

  it("skips the hunk header row", () => {
    const byRow = tokenizeChunkRows(
      highlighter,
      MID_TAG_ROWS,
      GrammarNames.TSX,
    );

    expect(byRow.has(0)).toBe(false);
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
