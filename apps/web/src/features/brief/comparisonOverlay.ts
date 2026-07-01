import type { CompareParam } from "./compareState";
import type { ComparisonMarkFiles, ComparisonSource } from "./comparison";
import type { RevisionNarrativeSkipReason } from "./types";

/**
 * @description The comparison overlay state shared down the story view (ADR
 * 0024). One state machine parameterized by the active Compare baseline —
 * mechanical marks drive the highlights; `source` binds each run's callout
 * (Revision narrative for Previous Brief, Delta for Your last review).
 */
export interface ComparisonOverlayState {
  /** The active Compare baseline; `off` means the overlay is inactive. */
  compare: CompareParam;
  /**
   * @description The mechanical marks to paint, or null when the overlay is off
   * or unavailable. Highlighting is derived ONLY from these (ADR 0024).
   */
  marks: ComparisonMarkFiles | null;
  /** The narrative source a run's callout binds against (per-baseline adapter). */
  source: ComparisonSource;
  /**
   * @description When the Previous-Brief narrative was deliberately skipped
   * (huge span / disabled by config), the reason — so callouts convey a
   * knowable skip rather than a generic "unavailable". Null otherwise.
   */
  skipReason: RevisionNarrativeSkipReason | null;
  /** Whether the overlay applies at all (compare != off and marks exist). */
  available: boolean;
  /**
   * @description Total runs across the brief; this is the jump-nav count.
   */
  runCount: number;
}
