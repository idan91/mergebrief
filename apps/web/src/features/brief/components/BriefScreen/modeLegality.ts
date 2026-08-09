// Block presence derives from the three axes — Lens (Story/Concerns), Scope
// (Full/Changes), Focus (on/off) — in one place. No per-block ad-hoc gating
// conditions may exist outside this derivation.
import type { ViewParam } from "../../comparison/compareState";

/**
 * The Lens axis vocabulary. Owned here; `Header` re-exports it for its
 * import sites (a Header↔modeLegality import cycle, even type-only, is a
 * defect).
 */
export type ViewMode = "story" | "concerns";

export interface ModeAxes {
  lens: ViewMode;
  /** The URL `view` param. */
  scope: ViewParam;
  focus: boolean;
}

/**
 * The header lens control's derived posture. `disabled` always carries the
 * honest reason the control announces.
 */
export type LensControlState =
  | { state: "active" }
  | { state: "disabled"; reason: string };

/** Changes-only scope disables the lens. */
export const SCOPE_LENS_REASON = "Lens applies to the full brief";

/**
 * Concerns+focus does not exist: entering focus snaps the lens to Story and
 * the control greys with this reason rather than silently no-oping.
 */
export const CONCERNS_FOCUS_LENS_REASON =
  "Focus mode reads the story lens — exit focus (Z) to switch";

/**
 * One row per region block. `toolbar` is three-valued because Concerns keeps
 * a trimmed bar (Filter + Risk attrs only).
 */
export interface RegionBlocks {
  /** Summary + IntentBar (capped) — one flag for both. */
  summary: boolean;
  toolbar: "full" | "filter-and-attrs" | "none";
  conversation: boolean;
  groupToc: boolean;
  lensControl: LensControlState;
}

/**
 * Axis precedence: Focus empties the region entirely (and implies Story);
 * Changes scope keeps only the summary; only Full scope reads the lens.
 */
export function deriveRegionBlocks(axes: ModeAxes): RegionBlocks {
  if (axes.focus) {
    return {
      summary: false,
      toolbar: "none",
      conversation: false,
      groupToc: false,
      lensControl: { state: "disabled", reason: CONCERNS_FOCUS_LENS_REASON },
    };
  }
  if (axes.scope === "changes") {
    return {
      summary: true,
      toolbar: "none",
      conversation: false,
      groupToc: false,
      lensControl: { state: "disabled", reason: SCOPE_LENS_REASON },
    };
  }
  return axes.lens === "story"
    ? {
        summary: true,
        toolbar: "full",
        conversation: true,
        groupToc: true,
        lensControl: { state: "active" },
      }
    : {
        summary: true,
        toolbar: "filter-and-attrs",
        conversation: true,
        groupToc: false,
        lensControl: { state: "active" },
      };
}
