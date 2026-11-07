import type { PathSegment } from "./types";

/** Each directory keeps its trailing slash, so a break can follow it. */
export function splitPathSegments(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let key = "";

  for (const text of path.split(/(?<=\/)/)) {
    key += text;
    segments.push({ key, text });
  }
  return segments;
}
