import type { AttributeDisplayMeta } from "../../../utils/repoConfig";
import type {
  FilePathDirectory,
  FilePathParts,
  GroupSummarySegment,
} from "./types";

const INLINE_CODE = /`([^`]+)`/g;

/** Backtick spans become code segments; everything else stays prose. */
export function splitInlineCode(text: string): GroupSummarySegment[] {
  const segments: GroupSummarySegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_CODE)) {
    const [whole, code] = match;
    if (match.index > cursor) {
      segments.push({
        offset: cursor,
        text: text.slice(cursor, match.index),
        code: false,
      });
    }
    segments.push({ offset: match.index, text: code ?? "", code: true });
    cursor = match.index + whole.length;
  }

  if (cursor < text.length) {
    segments.push({ offset: cursor, text: text.slice(cursor), code: false });
  }
  return segments;
}

/** Each directory keeps its trailing slash, so a break can follow it. */
export function splitFilePath(path: string): FilePathParts {
  const cut = path.lastIndexOf("/") + 1;
  const directories: FilePathDirectory[] = [];
  let key = "";

  for (const part of path.slice(0, cut).split("/").slice(0, -1)) {
    key += `${part}/`;
    directories.push({ key, text: `${part}/` });
  }
  return { directories, basename: path.slice(cut) };
}

/** Repo-policy and de-emphasized risks carry detail behind a disclosure. */
export function isDisclosedRisk(
  meta: AttributeDisplayMeta | undefined,
): boolean {
  return meta?.source === "repo-policy" || meta?.deEmphasized === true;
}
