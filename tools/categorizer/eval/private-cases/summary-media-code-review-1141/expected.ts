import type { EvalProperty } from "../../properties";
import {
  buildSummaryMediaGuards,
  listPointerKeys,
  listShownKeys,
} from "../summary-media-props";

/**
 * A visual change whose description carries its own evidence: four
 * skeleton-beside-code screenshots in single-cell tables, then two own-repo
 * mp4 links. The realistic many-item case: something should earn a place,
 * and the cap and the pointer limit both bind.
 */
export const properties: EvalProperty[] = [
  ...buildSummaryMediaGuards(),
  {
    id: "offers-summary-media",
    description:
      "a change whose point is how it looks: the brief shows an item or points at a set",
    check: (brief) => {
      const placedCount =
        listShownKeys(brief).length + listPointerKeys(brief).length;
      return placedCount > 0;
    },
  },
];
