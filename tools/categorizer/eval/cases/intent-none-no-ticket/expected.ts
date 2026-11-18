import type { EvalProperty } from "../../properties";

/**
 * None case: the button-under-split diff with a boilerplate title, an empty
 * body and no links, so specificity must be none. The second property borrows
 * the base case's headline grouping check as a canary for the base story.
 * `intent-alarm-buckets-empty` passes trivially on an unavailable check: it is
 * a validator floor, while `intent-none` and `intent-not-precise` carry the verdict.
 */
export const properties: EvalProperty[] = [
  {
    id: "intent-none",
    description:
      "a junk title + empty body + no ticket reads as none specificity (no usable stated intent)",
    check: (brief) => brief.intentCheck?.specificity === "none",
  },
  {
    id: "intent-not-precise",
    description:
      "the safety-critical boundary scored alone: never precise (none→broad is a cosmetic miss; none→precise means guessed gaps)",
    check: (brief) => brief.intentCheck?.specificity !== "precise",
  },
  {
    id: "at-least-two-groups",
    description:
      "base-story canary (borrowed from button-under-split): the two intents still split into >=2 change groups",
    // Baselined 5/5 with a measured tail: three 5-run samples scored 5/5, 3/5
    // and 5/5, both failures collapsing the diff into one group. A REGRESSION
    // here may be that tail: re-run the case before acting on it. The origin
    // case's `scss-supports-the-refactor-group` (baselined 2/5) shows the same
    // borderline grouping; it is not a property defect.
    check: (brief) => brief.changeGroups.length >= 2,
  },
  {
    id: "no-per-hunk-oversplit",
    description:
      "base-story canary (borrowed from button-under-split): at most 3 groups for a 3-file diff",
    check: (brief) => brief.changeGroups.length <= 3,
  },
  {
    id: "intent-alarm-buckets-empty",
    description:
      "the alarm buckets stay empty on an unavailable intent check — the validator's never-a-guessed-gap floor covers all five buckets",
    check: (brief) =>
      (brief.intentCheck?.deviations ?? []).length === 0 &&
      (brief.intentCheck?.maskedFixes ?? []).length === 0,
  },
];
