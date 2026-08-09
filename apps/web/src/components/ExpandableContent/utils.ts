/** Hysteresis band: content within this much of the cap is treated as fitting. */
export const CAP_HYSTERESIS_PX = 8;

const CAP_PATTERN = /^(-?\d*\.?\d+)(px|rem)$/;

/**
 * Resolves the computed `--expandable-content-text-cap` token to pixels. An unregistered custom
 * property's computed value is its specified token, so a rem cap arrives
 * unresolved and has to be scaled by the root font size here.
 */
export function parseCapPx(
  rawValue: string,
  rootFontSizePx: number,
): number | undefined {
  const match = CAP_PATTERN.exec(rawValue.trim());
  if (match === null) return undefined;
  const [, amount, unit] = match;
  if (amount === undefined) return undefined;
  const value = Number.parseFloat(amount);
  if (!Number.isFinite(value)) return undefined;
  return unit === "rem" ? value * rootFontSizePx : value;
}

export function exceedsCap(contentHeightPx: number, capPx: number): boolean {
  return contentHeightPx > capPx + CAP_HYSTERESIS_PX;
}
