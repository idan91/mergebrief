import type { MediaKey } from "./types";

export const HTTPS_PREFIX = "https://";
export const MERMAID_KEY_PREFIX = "mermaid:";
/** `mermaid:` and a sha256 digest in lowercase hex, as `buildMermaidMediaKey` writes it. */
const MERMAID_KEY_PATTERN = /^mermaid:[\da-f]{64}$/u;

/**
 * An https address or a diagram's `mermaid:` hash: the two forms a key
 * takes. Imports nothing at runtime, so the stored Brief shape can check a
 * key without loading the extractor.
 */
export function isMediaKey(value: string): value is MediaKey {
  const isAddress =
    value.startsWith(HTTPS_PREFIX) && value.length > HTTPS_PREFIX.length;
  const isDiagramHash = MERMAID_KEY_PATTERN.test(value);
  return isAddress || isDiagramHash;
}
