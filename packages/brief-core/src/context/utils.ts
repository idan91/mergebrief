const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

/**
 * At most `maxUnits` UTF-16 units of `text`, never ending on a lone high
 * surrogate: the model API refuses a string that does.
 */
export function truncateToCodeUnits(text: string, maxUnits: number): string {
  if (maxUnits <= 0) {
    return "";
  }
  if (text.length <= maxUnits) {
    return text;
  }
  const lastKept = text.charCodeAt(maxUnits - 1);
  const splitsPair =
    lastKept >= HIGH_SURROGATE_MIN && lastKept <= HIGH_SURROGATE_MAX;
  if (splitsPair) {
    return text.slice(0, maxUnits - 1);
  }
  return text.slice(0, maxUnits);
}
