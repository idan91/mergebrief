import type { SizedDiff } from "../types";

const PAST_LATIN1_PATTERN = /[\u{100}-\u{10ffff}]/u;

/** V8 holds a Latin-1-only string at one byte per unit, any other at two. */
export function measureHeldBytes(diff: string): number {
  const bytesPerUnit = PAST_LATIN1_PATTERN.test(diff) ? 2 : 1;
  return diff.length * bytesPerUnit;
}

export function readSizedBytes(entry: SizedDiff): number {
  return entry.bytes;
}
