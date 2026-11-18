// Which page regions are visible derives from the two reading modes, Scope
// (Full/Changes) and Focus (on/off), in one place. No per-region ad-hoc
// gating conditions may exist outside this derivation.
import type { ViewParam } from "../../../../model/comparison/compare-state";

export interface ReadingModes {
  /** The URL `view` param. */
  scope: ViewParam;
  focus: boolean;
}

/** One flag per page region. */
export interface VisibleRegions {
  /** Summary + IntentBar (capped): one flag for both. */
  summary: boolean;
  toolbar: boolean;
  /** Renders in the summary's masthead, so it is never true without summary. */
  conversation: boolean;
  sidebar: boolean;
  /** The carried-forward review bar. */
  carryOver: boolean;
  /** The phone's bottom bar; CSS shows it only at the mobile breakpoint. */
  phoneBar: boolean;
  /** The sideways phone's one row; CSS shows it only on a phone held sideways. */
  landscapeRow: boolean;
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
      carryOver: false,
      phoneBar: false,
      landscapeRow: false,
    };
  }
  if (modes.scope === "changes") {
    return {
      summary: true,
      toolbar: false,
      conversation: false,
      sidebar: false,
      carryOver: true,
      phoneBar: true,
      landscapeRow: true,
    };
  }
  return {
    summary: true,
    toolbar: true,
    conversation: true,
    sidebar: true,
    carryOver: true,
    phoneBar: true,
    landscapeRow: true,
  };
}
