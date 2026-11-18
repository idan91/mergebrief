/** Small, cohesive collection primitives shared across the app (domain-free). */

/** Return a new Set with `value` toggled (added if absent, removed if present). */
export function toggleSet<T>(current: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(current);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

/** Inclusive integer range between two indices, in ascending order. */
export function rangeBetween(start: number, end: number): number[] {
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return Array.from({ length: high - low + 1 }, (_, index) => low + index);
}
