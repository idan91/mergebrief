/** The whole pinned stack as one registered length; the header writes it. */
export const STICKY_STACK_HEIGHT_VAR = "--sticky-stack-h";

/** The page's value for a registered length; `fallback` where the page carries none. */
export function readNumericCssVar(name: string, fallback = 0): number {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
