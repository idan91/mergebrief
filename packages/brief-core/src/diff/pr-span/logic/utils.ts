/** A blob's lines, without the empty one a trailing newline would leave. */
export function splitTextLines(content: string | undefined): string[] {
  if (content === undefined || content === "") {
    return [];
  }
  const lines = content.split("\n");
  if (content.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}
