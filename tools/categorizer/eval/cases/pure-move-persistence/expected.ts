import type { EvalProperty } from "../../properties";
import { dominantCategories, fires } from "../../briefQueries";

/**
 * acme/mergebrief#96: persistence folded into role folders (db / stores /
 * auth): 25 files, relocation plus import-specifier edits, zero behavior
 * change. Measures move classification: the story is relocation, and
 * nothing here should read as new capability or invented abstraction.
 */
export const properties: EvalProperty[] = [
  {
    id: "move-category-present",
    description:
      "at least one group is dominantly pure-move or move-with-edits",
    check: (brief) =>
      dominantCategories(brief).some(
        (category) =>
          category === "pure-move" || category === "move-with-edits",
      ),
  },
  {
    id: "no-behavior-categories",
    description:
      "no group reads as new-feature, bugfix, or schema-change — relocation changes no behavior",
    check: (brief) =>
      dominantCategories(brief).every(
        (category) =>
          category !== "new-feature" &&
          category !== "bugfix" &&
          category !== "schema-change",
      ),
  },
  {
    id: "no-new-abstraction",
    description:
      "moving existing modules into folders invents no new named abstraction",
    check: (brief) => !fires(brief, "new-abstraction"),
  },
  {
    id: "coherent-grouping",
    description:
      "one restructure reads as few stories: between 1 and 4 groups for 25 relocated files",
    check: (brief) =>
      brief.changeGroups.length >= 1 && brief.changeGroups.length <= 4,
  },
];
