import { CHUNK_ROW_CEILING } from "./consts";
import { DiffLineKinds, type DiffLineKind, type TokenizableRow } from "./types";

/**
 * Both context kinds paint one unchanged line present on both sides; only
 * their provenance differs, so every side, pairing and grammar decision
 * treats them alike.
 */
export function isContextKind(kind: DiffLineKind): boolean {
  return kind === DiffLineKinds.CTX || kind === DiffLineKinds.EXPANDED_CONTEXT;
}

/** Above the ceiling the tokenize cost outruns what a reader can scan. */
export function isChunkTokenizable(rowCount: number): boolean {
  return rowCount > 0 && rowCount <= CHUNK_ROW_CEILING;
}

// FNV-1a over the snippet's own text. A snippet has no id of its own and its
// content IS its identity, so two comments quoting the same lines of the same
// file share the one cached reply.
const FNV_OFFSET = 2_166_136_261;
const FNV_PRIME = 16_777_619;

/** A cache key for rows with no id, anchored on the file they belong to. */
export function buildSnippetKey(
  filePath: string,
  rows: readonly TokenizableRow[],
): string {
  let hash = FNV_OFFSET;
  let totalLength = 0;

  for (const row of rows) {
    totalLength += row.content.length;
    for (const character of `${row.kind} ${row.content} `) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, FNV_PRIME);
    }
  }

  // Row count and total length ride with the 32-bit hash, so two snippets on
  // one file collide only if they match in shape as well as in hash.
  return `${filePath}#${rows.length}.${totalLength}.${(hash >>> 0).toString(36)}`;
}
