// Which page regions are visible derives from the two reading modes — Scope
// (Full/Changes) and Focus (on/off) — in one place. No per-region ad-hoc
// gating conditions may exist outside this derivation.
import type { ViewParam } from "../../comparison/compareState";

export interface ReadingModes {
  /** The URL `view` param. */
  scope: ViewParam;
  focus: boolean;
}

/** One flag per page region. */
export interface VisibleRegions {
  /** Summary + IntentBar (capped) — one flag for both. */
  summary: boolean;
  toolbar: boolean;
  conversation: boolean;
  sidebar: boolean;
}

/**
 * Mode precedence: Focus hides every region; Changes scope keeps
 * only the summary.
 */
export function deriveVisibleRegions(modes: ReadingModes): VisibleRegions {
  if (modes.focus) {
    return {
      summary: false,
      toolbar: false,
      conversation: false,
      sidebar: false,
    };
  }
  if (modes.scope === "changes") {
    return {
      summary: true,
      toolbar: false,
      conversation: false,
      sidebar: false,
    };
  }
  return {
    summary: true,
    toolbar: true,
    conversation: true,
    sidebar: true,
  };
}
