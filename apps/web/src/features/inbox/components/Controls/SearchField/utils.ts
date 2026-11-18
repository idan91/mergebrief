import { shapeSearchText } from "../../../search";
import { OWN_WRITES_KEPT } from "./consts";

/**
 * Whether the URL's search text moved without this field writing it: Clear,
 * Back, a link. The URL landing on what the field holds, or on a write the
 * field made a moment ago, is the field's own change catching up.
 */
export function isOutsideChange(
  urlText: string,
  fieldText: string,
  ownWrites: readonly string[],
): boolean {
  const matchesField = urlText === shapeSearchText(fieldText);
  return !matchesField && !ownWrites.includes(urlText);
}

export function rememberOwnWrite(
  ownWrites: readonly string[],
  written: string,
): readonly string[] {
  return [...ownWrites, written].slice(-OWN_WRITES_KEPT);
}

/** The writes still on their way once the URL holds `urlText`: that write landed, and so did every one before it. */
export function dropLandedWrites(
  ownWrites: readonly string[],
  urlText: string,
): readonly string[] {
  const landedAt = ownWrites.lastIndexOf(urlText);
  return ownWrites.slice(landedAt + 1);
}
