import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { normalizeMediaAddress } from "../../media-address";
import { isMediaKey, MERMAID_KEY_PREFIX } from "../key";
import type { MediaKey } from "../types";

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
