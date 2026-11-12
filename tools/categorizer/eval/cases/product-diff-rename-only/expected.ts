import { ChangeGroupCategories } from "types/reviews";
import type { EvalProperty } from "../../properties";
import { dominantCategories } from "../../briefQueries";
import {
  buildAvailableProperty,
  isProductDiffAvailable,
  listProductChanges,
} from "../product-diff-props";

/**
 * code-review#1287: `ButtonVariants.ACCENT` renamed `PRIMARY` and its value
 * `"accent"` renamed `"primary"` across 24 files (call sites, tests, a snapshot
 * and the `[data-variant]` selectors), each selector keeping its fill. No
 * outcome moves, so the section is read and empty. Listing the renamed value
 * or the call-site edits fails `rename-no-product-changes`; the available check
 * keeps the empty-list properties from passing on an absent section.
 */
const BEHAVIOUR_CATEGORIES = new Set<string>([
  ChangeGroupCategories.NEW_FEATURE,
  ChangeGroupCategories.BUGFIX,
  ChangeGroupCategories.SCHEMA_CHANGE,
]);

export const properties: EvalProperty[] = [
  buildAvailableProperty(),
  {
    id: "rename-no-product-changes",
    description:
      "a rename that leaves every outcome as it was lists no Product change",
    check: (brief) => {
      const listsNone = listProductChanges(brief).length === 0;
      const isReadAndEmpty = isProductDiffAvailable(brief) && listsNone;
      return isReadAndEmpty;
    },
  },
  {
    id: "rename-has-more-false",
    description:
      "pipeline guarantee: an empty Product diff never claims more changes than it lists",
    check: (brief) => {
      const claimsNoMore = brief.productDiff?.hasMore === false;
      const isReadAndComplete = isProductDiffAvailable(brief) && claimsNoMore;
      return isReadAndComplete;
    },
  },
  {
    id: "rename-groups-not-behavioural",
    description:
      "the section is read and the brief itself reads the rename as no new feature, fix or schema change, so an empty section agrees with it",
    check: (brief) => {
      const categories = dominantCategories(brief);
      const readsAsBehaviour = categories.some((category) =>
        BEHAVIOUR_CATEGORIES.has(category),
      );
      const readsAsRename = categories.length > 0 && !readsAsBehaviour;
      const isReadAsRename = isProductDiffAvailable(brief) && readsAsRename;
      return isReadAsRename;
    },
  },
];
