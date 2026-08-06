// The mode model's legality table (BRIEF-134 spec, "The mode model: three
// axes, one legality table"): block presence DERIVES from the three axes —
// Lens (Story/Concerns), Scope (Full/Changes), Focus (on/off) — in one place.
// No per-block ad-hoc gating conditions may exist outside this derivation.
import type { ViewParam } from "../../comparison/compareState";

/**
 * The Lens axis vocabulary (Story/Concerns). Owned here — the mode model is
 * the axis's source of truth; `Header` re-exports it for its historical
 * import sites (a Header↔modeLegality import cycle, even type-only, is a
 * defect).
 */
export type ViewMode = "story" | "concerns";

/** The three mode axes, exactly as the spec names them. */
export interface ModeAxes {
  /** Story/Concerns — session state. */
  lens: ViewMode;
  /** Full/Changes — the URL `view` param. */
  scope: ViewParam;
  /** Focus mode — session state. */
  focus: boolean;
}

/**
 * The header lens control's derived posture. Never silently overridden:
 * `disabled` always carries the honest reason the control announces
 * (the disabled-Compare-options pattern).
 */
export type LensControlState =
  | { state: "active" }
  | { state: "disabled"; reason: string };

/** The scope rule's reason: Changes-only disables the lens (spec verbatim). */
export const SCOPE_LENS_REASON = "Lens applies to the full brief";

/**
 * The focus rule's reason — the explicit contract replacing the silent
 * `setViewMode("story")`: entering focus still snaps the lens to Story
 * (documented at the toggle), and while focus is on the control is greyed
 * with this reason instead of silently no-oping ("Concerns+focus does not
 * exist" — the table's `n/a (Story implied)` cell).
 */
export const CONCERNS_FOCUS_LENS_REASON =
  "Focus mode reads the story lens — exit focus (Z) to switch";

/**
 * One row per region block in the spec's table. `toolbar` is three-valued
 * because Concerns keeps a trimmed bar (Filter + Risk attrs only).
 */
export interface RegionBlocks {
  /** Summary + IntentBar (capped) — one table row, one flag. */
  summary: boolean;
  toolbar: "full" | "filter-and-attrs" | "none";
  conversation: boolean;
  groupToc: boolean;
  lensControl: LensControlState;
}

/**
 * Derive block presence from the legality table. Axis precedence follows the
 * table's columns: Focus empties the region entirely (and implies Story);
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
