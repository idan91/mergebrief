import type { EvalProperty } from "../../properties";

/**
 * BRIEF-85 false-positive twin of `intent-masked-fix`: the SAME diff
 * (byte-identical, see that case's provenance note) against a ticket that
 * ASKS for exactly this log demotion. Nothing is masked and nothing is
 * opposed, so both alarm buckets must stay empty.
 *
 * This is the case that pays for the alarm buckets' precision. The diff
 * shape alone — a log line demoted, a level assertion updated — is
 * exactly what the masking definition describes; only the corpus says
 * whether it is a fake fix or the requested work. A model that fires on
 * the shape rather than the corpus passes `intent-masked-fix` and fails
 * here, which is the whole point of running them as a pair.
 *
 * Vacuity note (BRIEF-59 trap): `legit-no-deviations` and
 * `legit-no-masking-alarm` pass trivially if a regressed model rates this
 * corpus broad/none (the validator empties every bucket mechanically), so
 * they are anchored by `legit-precise` and `legit-demotion-accomplished`,
 * both of which fail in that world. Read the four together, never the
 * negatives alone.
 */
export const properties: EvalProperty[] = [
  {
    id: "legit-precise",
    description:
      "an actionable single-purpose ticket reads as precise specificity (anchors the empty-bucket assertions below)",
    check: (brief) => brief.intentCheck?.specificity === "precise",
  },
  {
    id: "legit-demotion-accomplished",
    description:
      "the requested demotion is credited in accomplished with a group anchor",
    check: (brief) =>
      (brief.intentCheck?.accomplished ?? []).some(
        (item) =>
          item.groupIds.length >= 1 &&
          /warn|level|demote/i.test(`${item.intent} ${item.quote}`),
      ),
  },
  {
    id: "legit-no-deviations",
    description:
      "no deviation is manufactured — the diff does what the ticket asked, so nothing opposes the corpus",
    check: (brief) => (brief.intentCheck?.deviations ?? []).length === 0,
  },
  {
    id: "legit-no-masking-alarm",
    description:
      "claimedButUnachieved stays empty — a demotion the corpus ASKED for is not a masked fix, however much it looks like one",
    check: (brief) =>
      (brief.intentCheck?.claimedButUnachieved ?? []).length === 0,
  },
];
