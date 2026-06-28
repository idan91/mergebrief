import type { Brief, RevisionChanges } from "./types";

/**
 * @description The revision-changes overlay state shared down the story view (ADR 0021).
 */
export interface RevisionOverlayState {
  /**
   * @description The sidecar to paint, or null when the overlay is unavailable or toggled off.
   */
  changes: RevisionChanges | null;
  /**
   * @description The opportunistic (prevHead, head) delta for callout summaries, if loaded.
   */
  delta: Brief | null;
  available: boolean;
  enabled: boolean;
  /**
   * @description Total runs across the brief; this is the jump-nav count.
   */
  runCount: number;
  setEnabled: (enabled: boolean) => void;
}
