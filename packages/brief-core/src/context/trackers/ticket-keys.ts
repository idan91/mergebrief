import { createEmbeddedUrlCheck } from "../embedded-urls";

export interface TicketKeyHit {
  readonly index: number;
  /** The prefix upper-cased, then the digits as written: `ACME-0012`. */
  readonly key: `${string}-${string}`;
}

/** Text as a pattern that matches it literally. */
export function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `PREFIX-N` under any of the prefixes, case-insensitive, outside any URL; a
 * trailing hyphen is a branch or slug separator, never part of the key. One
 * pattern for all prefixes keeps the offsets increasing, which the URL check
 * requires.
 */
export function collectTicketKeys(
  text: string,
  prefixes: readonly string[],
): TicketKeyHit[] {
  if (prefixes.length === 0) {
    return [];
  }
  const alternation = prefixes.map(escapePattern).join("|");
  const pattern = new RegExp(
    String.raw`(?<![\w-])(${alternation})-(\d+)(?!\w)`,
    "gi",
  );
  const isInUrl = createEmbeddedUrlCheck(text);
  const hits: TicketKeyHit[] = [];

  for (const match of text.matchAll(pattern)) {
    if (isInUrl(match.index)) {
      continue;
    }
    const prefix = match[1] ?? "";
    const digits = match[2] ?? "";
    hits.push({ index: match.index, key: `${prefix.toUpperCase()}-${digits}` });
  }
  return hits;
}
