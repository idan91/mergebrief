import type { EvalProperty } from "../../properties";

/**
 * False-positive twin of `intent-masked-fix`: the byte-identical diff against a
 * ticket that asks for exactly this log demotion, so both alarm buckets stay
 * empty. The diff shape alone matches the masking definition; only the source
 * says whether it is a fake fix or the requested work. Run the two as a pair.
 * `legit-no-deviations` and `legit-no-masking-alarm` pass trivially on a
 * broad/none read; `legit-precise` and `legit-demotion-accomplished` anchor them.
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
      "no deviation is manufactured — the diff does what the ticket asked, so nothing opposes the sources",
    check: (brief) => (brief.intentCheck?.deviations ?? []).length === 0,
  },
  {
    id: "legit-no-masking-alarm",
    description:
      "maskedFixes stays empty — a demotion the sources ASKED for is not a masked fix, however much it looks like one",
    check: (brief) => (brief.intentCheck?.maskedFixes ?? []).length === 0,
  },
  {
    id: "legit-alignment-aligned",
    description:
      "a straightforward delivery of the ticket's goal reads as aligned",
    check: (brief) => brief.intentCheck?.alignment?.read === "aligned",
  },
];
