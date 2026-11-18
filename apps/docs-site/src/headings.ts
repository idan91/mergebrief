export interface MarkdownHeading {
  depth: number;
  text: string;
}

interface Fence {
  marker: string;
  length: number;
}

const FRONTMATTER_DELIMITER = "---";
const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const CODE_SPAN_TICKS = /`+/g;

/** ATX headings outside code fences and frontmatter, as the plain text a renderer slugs. */
export function readHeadings(markdown: string): MarkdownHeading[] {
  const lines = markdown.split("\n");
  const headings: MarkdownHeading[] = [];
  let fence: Fence | undefined;

  for (const line of lines.slice(findBodyStart(lines))) {
    if (fence) {
      fence = closesFence(line, fence) ? undefined : fence;
      continue;
    }

    fence = readFenceOpen(line);
    const heading = fence ? undefined : ATX_HEADING.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      headings.push({
        depth: heading[1].length,
        text: toPlainText(heading[2]),
      });
    }
  }

  return headings;
}

function findBodyStart(lines: readonly string[]): number {
  if (lines[0]?.trimEnd() !== FRONTMATTER_DELIMITER) {
    return 0;
  }

  const closing = lines.indexOf(FRONTMATTER_DELIMITER, 1);
  return closing === -1 ? 0 : closing + 1;
}

function readFenceOpen(line: string): Fence | undefined {
  const marker = FENCE_OPEN.exec(line)?.[1];
  if (!marker) {
    return undefined;
  }

  return { marker: marker.charAt(0), length: marker.length };
}

function closesFence(line: string, fence: Fence): boolean {
  const candidate = readFenceOpen(line);
  if (candidate?.marker !== fence.marker) {
    return false;
  }

  if (candidate.length < fence.length) {
    return false;
  }

  const trailing = line.trim().replace(/^[`~]+/, "");
  return trailing === "";
}

function toPlainText(inline: string): string {
  return inline.replace(INLINE_LINK, "$1").replace(CODE_SPAN_TICKS, "").trim();
}
