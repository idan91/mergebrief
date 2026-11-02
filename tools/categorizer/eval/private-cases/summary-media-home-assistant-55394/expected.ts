import type { EvalProperty } from "../../properties";
import {
  buildSummaryMediaGuards,
  listPointerKeys,
  listShownKeys,
  readItemKey,
} from "../../summary-media-props";

/**
 * home-assistant/frontend#55394: a Before | After table of two screenshots.
 * The item captions are the alt texts, so the model reads the comparison
 * from them, never from the table header. Apache-2.0, so it sits with the
 * private cases; its LICENSE is beside the fixture.
 */
const BEFORE_ITEM = 1;
const AFTER_ITEM = 2;

export const properties: EvalProperty[] = [
  ...buildSummaryMediaGuards(),
  {
    id: "shows-no-comparison-half",
    description: "neither half of the before/after pair is shown",
    check: (brief) => listShownKeys(brief).length === 0,
  },
  {
    id: "points-at-before-after-pair",
    description: "the pointer holds both the before and the after screenshot",
    check: (brief) => {
      const pointerKeys = listPointerKeys(brief);
      return (
        pointerKeys.includes(readItemKey(brief, BEFORE_ITEM)) &&
        pointerKeys.includes(readItemKey(brief, AFTER_ITEM))
      );
    },
  },
];
