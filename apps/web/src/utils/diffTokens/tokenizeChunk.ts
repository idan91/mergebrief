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
import type { DiffLine, GrammarName, RowTokenLine, RowTokenMap } from "./types";

/**
 * Colours one chunk's rows. The grammar must already be loaded into the
 * highlighter; this step is synchronous so a caller can time it as one unit.
 */
export function tokenizeChunkRows(
  highlighter: HighlighterCore,
  rows: DiffLine[],
  grammar: GrammarName,
): RowTokenMap {
  const sides = reconstructHunkSides(rows);
  const tokensBySide = sides.map((side) =>
    tokenizeSide(highlighter, side.text.join("\n"), grammar),
  );

  return mapTokensToRows(sides, tokensBySide);
}

/**
 * One reconstructed hunk side. The prelude rides as grammar context rather
 * than prepended text, so no synthetic line reaches a row.
 */
export function tokenizeSide(
  highlighter: HighlighterCore,
  text: string,
  grammar: GrammarName,
): RowTokenLine[] {
  const prelude = derivePrelude(text, grammar);

  const options: CodeToTokensBaseOptions = {
    lang: grammar,
    theme: MERGEBRIEF_THEME_NAME,
  };
  if (prelude !== undefined) options.grammarContextCode = prelude;

  return highlighter.codeToTokensBase(text, options).map(shapeTokenLine);
}

function shapeTokenLine(tokens: ThemedToken[]): RowTokenLine {
  return tokens.map((token) => ({
    text: token.content,
    classId: resolveClassId(token.color),
  }));
}
