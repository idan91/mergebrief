import { isAttachmentAssetId } from "contract/attachments";
import { SUMMARY_MEDIA_LABEL_MAX_CHARS } from "../../types";
import { stripKnownProseFences } from "../fences";
import {
  removeHiddenCharacters,
  sanitizeUntrustedText,
} from "../untrusted-text";
import {
  ADDRESS_PATTERN,
  CONTROL_CHARS,
  MEDIA_TEXT_MAX_CHARS,
  WHITESPACE_RUN,
} from "./consts";

/**
 * At most `maxChars` code points, so a cut never splits a surrogate pair.
 * Code points are also what zod's string `max` counts, so a capped label
 * passes the stored schema.
 */
function capText(text: string, maxChars: number): string {
  const codePoints = Array.from(text).slice(0, maxChars);
  return codePoints.join("").trim();
}

function collapseWhitespace(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

/**
 * A caption or heading as one quoted-ready line for the `<pr_media>` block:
 * sanitized like the description, every address removed, on one line. A
 * pasted asset's id, the caption it falls back to, reads as none.
 */
export function readMediaPromptText(
  text: string | undefined,
): string | undefined {
  if (text === undefined) {
    return undefined;
  }

  const sanitized = sanitizeUntrustedText(text);
  const withoutAddresses = stripKnownProseFences(
    sanitized.replace(ADDRESS_PATTERN, ""),
  );
  const line = capText(
    collapseWhitespace(withoutAddresses),
    MEDIA_TEXT_MAX_CHARS,
  );
  const isAssetId = isAttachmentAssetId(line);
  return line === "" || isAssetId ? undefined : line;
}

/**
 * Plain text: no hidden or control character, no address, one line, capped.
 * Hidden characters go before addresses, so one splitting an address cannot
 * hide it from the address strip and then vanish to rejoin it.
 */
export function cleanPointerLabel(label: string): string {
  const oneLine = collapseWhitespace(label);
  const visible = removeHiddenCharacters(oneLine).replace(CONTROL_CHARS, "");
  const withoutAddresses = visible.replace(ADDRESS_PATTERN, "");
  const collapsed = collapseWhitespace(withoutAddresses);
  return capText(collapsed, SUMMARY_MEDIA_LABEL_MAX_CHARS);
}
