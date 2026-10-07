import type { EvalProperty } from "../../properties";
import { chunksFor, firstGroupIndex, groupIdsFor } from "../../briefQueries";

/**
 * components#10 @ 3110bbb: ONE file (Button.tsx) carrying two entangled
 * intents: (a) new `rounded` prop (interface + default + render), (b)
 * class-map → data-* attribute refactor (Button.scss selector migration
 * supporting it, App.tsx call-site riding along). Observed under-split:
 * everything grouped as ONE group. The hard variant: the prop default
 * lands inside the rewritten render block. This case measures any
 * base-prompt emphasis tweak on sub-file intent splitting.
 */
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
    id: "scss-supports-the-refactor-group",
    description:
      "Button.scss belongs to a group that also carries a Button.tsx chunk (the refactor), never a group of its own or the prop group alone",
    check: (brief) => {
      const scssGroups = groupIdsFor(brief, "Button.scss");
      if (scssGroups.length !== 1) {
        return false;
      }
      return chunksFor(brief, "Button.tsx").some(
        (chunk) => chunk.changeGroupId === scssGroups[0],
      );
    },
  },
  {
    id: "api-group-before-refactor-group",
    description:
      "foundation-first: the prop/API group (no scss chunk) reads before the scss-carrying refactor group",
    check: (brief) => {
      const scssGroups = new Set(groupIdsFor(brief, "Button.scss"));
      const buttonGroups = groupIdsFor(brief, "Button.tsx");
      const apiIndex = firstGroupIndex(
        brief,
        (id) => buttonGroups.includes(id) && !scssGroups.has(id),
      );
      const refactorIndex = firstGroupIndex(brief, (id) => scssGroups.has(id));
      return apiIndex < refactorIndex;
    },
  },
  {
    id: "app-callsite-rides-along",
    description:
      "App.tsx is a call-site update riding with a Button group, not a story of its own",
    check: (brief) => {
      const appGroups = groupIdsFor(brief, "App.tsx");
      const buttonGroups = new Set([
        ...groupIdsFor(brief, "Button.tsx"),
        ...groupIdsFor(brief, "Button.scss"),
      ]);
      return (
        appGroups.length > 0 && appGroups.every((id) => buttonGroups.has(id))
      );
    },
  },
];
