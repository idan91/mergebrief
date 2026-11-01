import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { normalizeMediaAddress } from "../../media-address";
import { HTTPS_PREFIX, MERMAID_KEY_PREFIX } from "../consts";
import type { MediaKey } from "../types";

/** An https address or a diagram's `mermaid:` hash: the two forms a key takes. */
export function isMediaKey(value: string): value is MediaKey {
  return value.startsWith(HTTPS_PREFIX) || value.startsWith(MERMAID_KEY_PREFIX);
}

/** `address` normalised, so every form of one committed file is one key. */
export function buildAddressMediaKey(address: string): MediaKey | undefined {
  const key = normalizeMediaAddress(address);
  return isMediaKey(key) ? key : undefined;
}

/** `mermaid:` and the sha256 hex of `code`, the text of the fence's code element. */
export function buildMermaidMediaKey(code: string): MediaKey {
  const digest = sha256(utf8ToBytes(code));
  const key = `${MERMAID_KEY_PREFIX}${bytesToHex(digest)}`;
  if (!isMediaKey(key)) {
    throw new Error("A mermaid key lost its prefix");
  }
  return key;
}
