/**
 * Whether the viewer requests reduced motion (WCAG 2.3.3). SSR-safe (no
 * `window` → false) and checked at CALL time, not module load — the OS
 * setting can change mid-session. Shared home for the helper previously
 * duplicated per component (BriefPage / GroupTocBar / Callout).
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
