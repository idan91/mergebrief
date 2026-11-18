import { DIAGRAM_TYPE_BY_KEYWORD } from "../consts";
import { DiagramTypes, type DiagramType } from "../types";

const FRONT_MATTER_FENCE = "---";
const DIRECTIVE_OR_COMMENT_PREFIX = "%%";
const WHITESPACE = /\s+/;

function dropFrontMatter(lines: readonly string[]): readonly string[] {
  if (lines[0] !== FRONT_MATTER_FENCE) {
    return lines;
  }
  const closing = lines.indexOf(FRONT_MATTER_FENCE, 1);
  return closing === -1 ? [] : lines.slice(closing + 1);
}

function isKeywordLine(line: string): boolean {
  return line !== "" && !line.startsWith(DIRECTIVE_OR_COMMENT_PREFIX);
}

/** The diagram a Mermaid fence draws, read off its first keyword past front matter, directives and comments. */
export function readDiagramType(code: string): DiagramType {
  const lines = code.split("\n").map((line) => line.trim());
  const keywordLine = dropFrontMatter(lines).find(isKeywordLine) ?? "";
  const [keyword = ""] = keywordLine.split(WHITESPACE);
  return DIAGRAM_TYPE_BY_KEYWORD.get(keyword) ?? DiagramTypes.OTHER;
}
