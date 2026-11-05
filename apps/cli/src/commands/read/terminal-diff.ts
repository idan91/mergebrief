// A diff as a terminal shows it. A PR author controls these bytes, so every line
// is escaped first: a planted sequence could otherwise erase a line from the
// reviewer's screen. Piped output never comes through here.
import { HUNK_HEADER } from "brief-core/chunk-layout";
import { formatDisplayDiffLine } from "brief-core/hidden-chars";

const STYLE_ADDED = "\u001B[32m";
const STYLE_REMOVED = "\u001B[31m";
const STYLE_HUNK = "\u001B[36m";
const STYLE_FILE_HEADER = "\u001B[1m";
const STYLE_RESET = "\u001B[0m";

const CARRIAGE_RETURN = "\r";
const NO_NEWLINE_MARKER_LEAD = "\\";
const OMITTED_HUNK_COUNT = "1";

export interface TerminalDiffOptions {
  readonly color: boolean;
}

/** The hunk's lines still unread per side: a line's class depends on them, not on its prefix alone. */
interface HunkLinesLeft {
  oldSide: number;
  newSide: number;
}

/** On unless `NO_COLOR` is non-empty or the terminal declares it has no styling. */
export function isTerminalColorEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const noColor = env["NO_COLOR"];
  if (noColor !== undefined && noColor.length > 0) {
    return false;
  }
  return env["TERM"] !== "dumb";
}

function readHunkLineStyle(
  line: string,
  left: HunkLinesLeft,
): string | undefined {
  if (line.startsWith("+")) {
    left.newSide -= 1;
    return STYLE_ADDED;
  }
  if (line.startsWith("-")) {
    left.oldSide -= 1;
    return STYLE_REMOVED;
  }
  if (!line.startsWith(NO_NEWLINE_MARKER_LEAD)) {
    left.oldSide -= 1;
    left.newSide -= 1;
  }
  return undefined;
}

function readHeaderLineStyle(
  line: string,
  left: HunkLinesLeft,
): string | undefined {
  if (line.length === 0 || line.startsWith(NO_NEWLINE_MARKER_LEAD)) {
    return undefined;
  }

  const hunk = HUNK_HEADER.exec(line);
  if (hunk === null) {
    return STYLE_FILE_HEADER;
  }
  left.oldSide = Number(hunk.groups?.["oldCount"] ?? OMITTED_HUNK_COUNT);
  left.newSide = Number(hunk.groups?.["newCount"] ?? OMITTED_HUNK_COUNT);
  return STYLE_HUNK;
}

function renderLine(
  line: string,
  style: string | undefined,
  options: TerminalDiffOptions,
): string {
  const endsCrLf = line.endsWith(CARRIAGE_RETURN);
  const body = endsCrLf ? line.slice(0, -CARRIAGE_RETURN.length) : line;
  const shown = formatDisplayDiffLine(body);

  const styled =
    options.color && style !== undefined
      ? `${style}${shown}${STYLE_RESET}`
      : shown;
  return endsCrLf ? `${styled}${CARRIAGE_RETURN}` : styled;
}

export function renderTerminalDiff(
  text: string,
  options: TerminalDiffOptions,
): string {
  const left: HunkLinesLeft = { oldSide: 0, newSide: 0 };
  // A span diff has no final newline. Without one, a kept carriage return lets
  // the next stderr line overwrite the diff's last line.
  const endsItsLine = text.length === 0 || text.endsWith("\n");
  const terminated = endsItsLine ? text : `${text}\n`;

  const lines = terminated.split("\n").map((line) => {
    const inHunk = left.oldSide > 0 || left.newSide > 0;
    const style = inHunk
      ? readHunkLineStyle(line, left)
      : readHeaderLineStyle(line, left);
    return renderLine(line, style, options);
  });
  return lines.join("\n");
}
