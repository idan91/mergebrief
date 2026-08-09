import type { EvalProperty } from "../../properties";

/**
 * BRIEF-54 broad case: the button-under-split diff with a thin PR body and
 * an epic-style umbrella ticket (authored fixture link). The composite
 * source (one-line title + epic) defines no checkable change — specificity
 * must be broad, never a guessed gap (ADR 0009 unavailable-over-
 * provisional; the buckets themselves are mechanically emptied by the
 * validator, so the judgment under test is the specificity token).
 *
 * Vacuity note (BRIEF-85): `intent-alarm-buckets-empty` passes trivially
 * whenever the check is unavailable — which is exactly this case's expected
 * state, and also what a model producing nothing looks like. It is a floor
 * check on the validator, not a model-quality signal; `intent-broad` and
 * `intent-not-precise` carry the actual verdict here.
 */
const EPIC_URL = "https://tasks.example/DS-9";

export const properties: EvalProperty[] = [
  {
    id: "intent-broad",
    description:
      "an umbrella epic + one-line title reads as broad specificity (too general to check), never precise",
    check: (brief) => brief.intentCheck?.specificity === "broad",
  },
  {
    id: "intent-epic-url-cited",
    description:
      "the epic link is still cited as the ticket-like source it is (broad ≠ ignored)",
    check: (brief) => (brief.intentCheck?.ticketUrls ?? []).includes(EPIC_URL),
  },
  {
    id: "intent-not-precise",
    description:
      "the safety-critical boundary scored alone: never precise (broad→none is a cosmetic miss; broad→precise means guessed gaps)",
    check: (brief) => brief.intentCheck?.specificity !== "precise",
  },
  {
    id: "at-least-two-groups",
    description:
      "base-story canary (borrowed from button-under-split): the two intents still split into >=2 change groups",
    check: (brief) => brief.changeGroups.length >= 2,
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
