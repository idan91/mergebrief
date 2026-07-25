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
    // Baselined 5/5, but it has a MEASURED TAIL: across three 5-run samples
    // (2026-07-25, BRIEF-85 rebaseline) it scored 5/5, 3/5, 5/5 — 13/15 runs.
    // The two failures both collapsed the whole 4KB diff into ONE group
    // ("Refactor Button styling to data-attributes"), folding the styling
    // refactor, the pill prop, and the App call-site switch into a single
    // story. So a REGRESSION verdict here may be that tail rather than a real
    // break: RE-RUN the case before acting on it. The same instability shows
    // up as a flaky property on the origin case (button-under-split's
    // `scss-supports-the-refactor-group`, baselined 2/5) — grouping on this
    // diff is genuinely borderline, not a property defect.
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
