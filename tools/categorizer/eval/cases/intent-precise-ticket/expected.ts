import type { EvalProperty } from "../../properties";

/**
 * BRIEF-54 positive case: the copybutton-new-export diff with an authored
 * precise ticket (fixture link, tasks.example). Three of the ticket's four
 * asks are in the diff; "document the component on the docs site" is not —
 * the statedButMissing target. Corpus rule: the DIFF is the publishable
 * artifact (components#7); the ticket text is authored fixture data.
 */
const TICKET_URL = "https://tasks.example/DS-42";

export const properties: EvalProperty[] = [
  {
    id: "intent-precise",
    description:
      "an actionable ticket + descriptive PR body reads as precise specificity",
    check: (brief) => brief.intentCheck?.specificity === "precise",
  },
  {
    id: "intent-ticket-url-bound",
    description:
      "ticketUrls is exactly the injected ticket link (never invented, never dropped)",
    check: (brief) =>
      brief.intentCheck !== undefined &&
      brief.intentCheck.ticketUrls.length === 1 &&
      brief.intentCheck.ticketUrls[0] === TICKET_URL,
  },
  {
    id: "intent-accomplished-anchored",
    description:
      "at least one accomplished ask, and every accomplished ask carries a group anchor (validator prunes dangling ids — anchors surviving means the model cited real groups)",
    check: (brief) =>
      brief.intentCheck !== undefined &&
      brief.intentCheck.accomplished.length >= 1 &&
      brief.intentCheck.accomplished.every((item) => item.groupIds.length >= 1),
  },
  {
    id: "intent-docs-gap-found",
    description:
      "the one ask the diff does not deliver (docs-site usage example) lands in statedButMissing",
    check: (brief) =>
      (brief.intentCheck?.statedButMissing ?? []).some((item) =>
        /docs|documentation|usage example/i.test(`${item.intent} ${item.quote}`),
      ),
  },
];
