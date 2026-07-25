import type { EvalProperty } from "../../properties";

/**
 * BRIEF-54 none case: the button-under-split diff with a boilerplate title
 * ("updates"), an empty body, and no links — no usable stated intent
 * anywhere in the corpus. Specificity must be none. The second property
 * borrows the base case's headline grouping check as a canary that the
 * intent-check addition does not perturb the base story.
 *
 * Vacuity note (BRIEF-85): `intent-alarm-buckets-empty` passes trivially
 * whenever the check is unavailable — this case's expected state, and also
 * what a model producing nothing looks like. It is a floor check on the
 * validator, not a model-quality signal; `intent-none` and
 * `intent-not-precise` carry the actual verdict here.
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
      "the BRIEF-85 alarm buckets stay empty on an unavailable intent check — the validator's never-a-guessed-gap floor covers all five buckets",
    check: (brief) =>
      (brief.intentCheck?.deviations ?? []).length === 0 &&
      (brief.intentCheck?.claimedButUnachieved ?? []).length === 0,
  },
];
