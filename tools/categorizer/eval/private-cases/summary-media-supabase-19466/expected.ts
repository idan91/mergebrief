import type { EvalProperty } from "../../properties";
import {
  buildSummaryMediaGuards,
  hasDescriptionMedia,
} from "../summary-media-props";

/**
 * supabase/supabase#19466: the whole description is one GIF with alt text
 * "giphy", decoration with no bearing on the read-replica work in the diff.
 * Apache-2.0, so it sits with the private cases; its LICENSE is beside the
 * fixture.
 */
export const properties: EvalProperty[] = [
  ...buildSummaryMediaGuards(),
  {
    id: "nothing-for-decorative-gif",
    description:
      "a decorative GIF earns no Summary Media: nothing shown and no pointer",
    check: (brief) =>
      hasDescriptionMedia(brief) && brief.summaryMedia === undefined,
  },
];
