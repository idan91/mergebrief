/**
 * The next focused item for an arrow key in a menu; End and any other key
 * land last. This is the ARIA roving-tabindex pattern: one item is tabbable
 * and the arrows move which one.
 */
export function nextMenuFocusIndex(
  from: number,
  key: string,
  count: number,
): number {
  if (key === "ArrowDown") return (from + 1) % count;
  if (key === "ArrowUp") return (from - 1 + count) % count;
  if (key === "Home") return 0;
  return count - 1;
}
