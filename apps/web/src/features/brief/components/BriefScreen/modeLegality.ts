// Block presence derives from the two axes — Scope (Full/Changes) and Focus
// (on/off) — in one place. No per-block ad-hoc gating conditions may exist
// outside this derivation.
import type { ViewParam } from "../../comparison/compareState";

export interface ModeAxes {
  /** The URL `view` param. */
  scope: ViewParam;
  focus: boolean;
}

/** One row per region block. */
export interface RegionBlocks {
  /** Summary + IntentBar (capped) — one flag for both. */
  summary: boolean;
  toolbar: boolean;
  conversation: boolean;
  groupToc: boolean;
}

/**
 * Axis precedence: Focus empties the region entirely; Changes scope keeps
 * only the summary.
 */
export function deriveRegionBlocks(axes: ModeAxes): RegionBlocks {
  if (axes.focus) {
    return {
      summary: false,
      toolbar: false,
      conversation: false,
      groupToc: false,
    };
  }
  if (axes.scope === "changes") {
    return {
      summary: true,
      toolbar: false,
      conversation: false,
      groupToc: false,
    };
  }
  return {
    summary: true,
    toolbar: true,
    conversation: true,
    groupToc: true,
  };
}
