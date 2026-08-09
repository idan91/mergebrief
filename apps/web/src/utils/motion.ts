/**
 * Whether the viewer requests reduced motion. SSR-safe (no `window` → false)
 * and checked at CALL time, not module load — the OS setting can change
 * mid-session.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
