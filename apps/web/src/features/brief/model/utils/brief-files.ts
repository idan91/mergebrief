import type { Brief } from "../types";

/** The files the brief's diff touches, chunks and unattributed remainder alike. */
export function countBriefFiles(brief: Brief): number {
  const files = new Set(brief.chunks.map((chunk) => chunk.file));
  for (const entry of brief.unattributed ?? []) {
    files.add(entry.file);
  }
  return files.size;
}
