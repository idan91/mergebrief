import type {
  CodeToTokensBaseOptions,
  HighlighterCore,
  ThemedToken,
} from "shiki/core";

import { mapTokensToRows } from "./mapTokensToRows";
import { resolveClassId } from "./palette";
import { derivePrelude } from "./prelude";
import { reconstructHunkSides } from "./reconstructHunkSides";
import { MERGEBRIEF_THEME_NAME } from "./theme";
import { isContextKind } from "./utils";
import {
  DiffLineKinds,
  TokenizeModes,
  type TokenizableRow,
  type GrammarName,
  type RowTokenLine,
  type RowTokenMap,
  type TokenizeMode,
} from "./types";

/**
 * The one branch between the two shapes of input. The grammar must already
 * be loaded into the highlighter; this step is synchronous so a caller can
 * time it as one unit.
 */
export function tokenizeRows(
  highlighter: HighlighterCore,
  rows: TokenizableRow[],
  grammar: GrammarName,
  mode: TokenizeMode,
): RowTokenMap {
  if (mode === TokenizeModes.STANDALONE) {
    return tokenizeStandaloneRows(highlighter, rows, grammar);
  }

  return tokenizeChunkRows(highlighter, rows, grammar);
}

/** Colours one chunk's rows through both reconstructed hunk sides. */
export function tokenizeChunkRows(
  highlighter: HighlighterCore,
  rows: TokenizableRow[],
  grammar: GrammarName,
): RowTokenMap {
  const sides = reconstructHunkSides(rows);
  const tokensBySide = sides.map((side) =>
    tokenizeSide(
      highlighter,
      side.text.join("\n"),
      grammar,
      side.startLine === 1,
    ),
  );

  return mapTokensToRows(sides, tokensBySide);
}

/**
 * Rows that are already one side of one file: a suggestion block, an
 * added-only narrative slice, a preview. They tokenize as the snippet they
 * are, in row order, so nothing is reconstructed and no prelude is invented
 * beyond what the snippet's own text asks for. Full-width rows carry no code
 * and take no tokens.
 */
export function tokenizeStandaloneRows(
  highlighter: HighlighterCore,
  rows: TokenizableRow[],
  grammar: GrammarName,
): RowTokenMap {
  const rowIndexes: number[] = [];
  const text: string[] = [];

  for (const [index, row] of rows.entries()) {
    if (!isCodeDiffRow(row)) {
      continue;
    }

    rowIndexes.push(index);
    text.push(row.content);
  }

  const byRow: RowTokenMap = new Map();
  if (text.length === 0) {
    return byRow;
  }

  const lines = tokenizeSide(highlighter, text.join("\n"), grammar);
  for (const [line, rowIndex] of rowIndexes.entries()) {
    const tokens = lines[line];
    if (tokens !== undefined) {
      byRow.set(rowIndex, tokens);
    }
  }

  return byRow;
}

function isCodeDiffRow(row: TokenizableRow): boolean {
  return (
    row.kind === DiffLineKinds.ADD ||
    row.kind === DiffLineKinds.DEL ||
    isContextKind(row.kind)
  );
}

/**
 * One reconstructed hunk side. The prelude rides as grammar context rather
 * than prepended text, so no synthetic line reaches a row.
 */
export function tokenizeSide(
  highlighter: HighlighterCore,
  text: string,
  grammar: GrammarName,
  atFileStart = false,
): RowTokenLine[] {
  const prelude = atFileStart ? undefined : derivePrelude(text, grammar);

  const options: CodeToTokensBaseOptions = {
    lang: grammar,
    theme: MERGEBRIEF_THEME_NAME,
  };
  if (prelude !== undefined) {
    options.grammarContextCode = prelude;
  }

  return highlighter.codeToTokensBase(text, options).map(shapeTokenLine);
}

function shapeTokenLine(tokens: ThemedToken[]): RowTokenLine {
  return tokens.map((token) => ({
    text: token.content,
    classId: resolveClassId(token.color),
  }));
}
