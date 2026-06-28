import type { Brief, RevisionChanges } from "./types";

/** The revision-changes overlay state shared down the story view (ADR 0021). */
export interface RevisionOverlayState {
  /** The sidecar to paint, or null when the overlay is unavailable or toggled off. */
  changes: RevisionChanges | null;
  /** The opportunistic (prevHead,head) delta for callout summaries, if loaded. */
  delta: Brief | null;
  available: boolean;
  enabled: boolean;
  /** Total runs across the brief — the jump-nav count. */
  runCount: number;
  setEnabled: (enabled: boolean) => void;
}
