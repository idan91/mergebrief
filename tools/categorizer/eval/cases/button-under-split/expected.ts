import type { EvalProperty } from "../../properties";
import {
  firstGroupIndex,
  findGroupIdOwningAddedLine,
  groupIdsFor,
} from "../../briefQueries";

/**
 * components#10 @ 3110bbb: ONE file (Button.tsx) carrying two entangled
 * intents: (a) new `rounded` prop (interface + default + render), (b)
 * class-map → data-* attribute refactor (Button.scss selector migration
 * supporting it), plus App.tsx's own variant-to-type call-site change.
 * Observed under-split: everything grouped as ONE group. The hard
 * variant: the prop default lands inside the rewritten render block. This
 * case measures any base-prompt emphasis tweak on sub-file intent splitting.
 */

/** New-side Button.tsx lines: `rounded?: boolean` and `data-variant={variant}`. */
const ROUNDED_PROP_LINE = 28;
const DATA_VARIANT_LINE = 51;

export const properties: EvalProperty[] = [
  {
    id: "at-least-two-groups",
    description:
      "the two intents split: >=2 change groups (API change vs styling-mechanism refactor)",
    check: (brief) => brief.changeGroups.length >= 2,
  },
  {
    id: "no-per-hunk-oversplit",
    description:
      "the symmetric failure is worse for story: at most 3 groups for a 3-file diff",
    check: (brief) => brief.changeGroups.length <= 3,
  },
  {
    id: "no-scss-only-group",
    description:
      "every group carrying a Button.scss chunk also carries a Button.tsx chunk: styles split with the intent they serve, never a styles group",
    check: (brief) => {
      const scssGroups = groupIdsFor(brief, "Button.scss");
      const buttonGroups = new Set(groupIdsFor(brief, "Button.tsx"));
      const stylesRideWithButton =
        scssGroups.length > 0 && scssGroups.every((id) => buttonGroups.has(id));
      return stylesRideWithButton;
    },
  },
  {
    id: "refactor-group-before-rounded-group",
    description:
      "the data-attribute refactor reads before the rounded prop: the title leads with it and the prop uses its attribute scheme",
    check: (brief) => {
      const refactorGroup = findGroupIdOwningAddedLine(
        brief,
        "Button.tsx",
        DATA_VARIANT_LINE,
      );
      const roundedGroup = findGroupIdOwningAddedLine(
        brief,
        "Button.tsx",
        ROUNDED_PROP_LINE,
      );
      const refactorSplitFromRounded =
        refactorGroup !== undefined && refactorGroup !== roundedGroup;
      if (!refactorSplitFromRounded) {
        return false;
      }
      const refactorIndex = firstGroupIndex(
        brief,
        (id) => id === refactorGroup,
      );
      const roundedIndex = firstGroupIndex(brief, (id) => id === roundedGroup);
      return refactorIndex < roundedIndex;
    },
  },
  {
    id: "app-callsite-outside-rounded-group",
    description:
      "App.tsx's variant-to-type change is not part of the rounded prop: it never rides in the rounded group",
    check: (brief) => {
      const appGroups = groupIdsFor(brief, "App.tsx");
      const roundedGroup = findGroupIdOwningAddedLine(
        brief,
        "Button.tsx",
        ROUNDED_PROP_LINE,
      );
      const appOutsideRounded =
        appGroups.length > 0 &&
        roundedGroup !== undefined &&
        !appGroups.includes(roundedGroup);
      return appOutsideRounded;
    },
  },
];
