import { MIN_TAIL_COLUMNS } from "../../consts";

export interface WrapLine {
  /** The line's index in the row, 1 for the first wrapped line. */
  line: number;
  /** Columns the line's bar is drawn across. */
  columns: number;
}

/**
 * The lines past the first a side's code wraps onto: full lines, then a
 * tail as long as what is left, at most the lines the row spans and never
 * wider than a line.
 */
export function planWrapLines(
  width: number,
  span: number,
  columns: number,
): WrapLine[] {
  const ownLines = Math.max(Math.ceil(width / columns), 1);
  const drawnLines = Math.min(span, ownLines);
  const lines: WrapLine[] = [];

  for (let line = 1; line < drawnLines; line += 1) {
    const last = line === drawnLines - 1;
    const left = Math.max(width - columns * line, MIN_TAIL_COLUMNS);
    const tail = Math.min(left, columns);
    lines.push({ line, columns: last ? tail : columns });
  }

  return lines;
}
