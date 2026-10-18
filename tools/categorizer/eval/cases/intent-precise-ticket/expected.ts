import type { EvalProperty } from "../../properties";

/**
 * Positive case: the copybutton-new-export diff with an authored precise ticket.
 * Three of its four asks are in the diff; "document the component on the docs
 * site" is not, and is the statedButMissing target. The diff is the publishable
 * artifact; the ticket text is authored fixture data. `intent-alarm-buckets-empty`
 * also passes on a broad/none read; `intent-precise` and
 * `intent-accomplished-anchored` anchor it.
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
        /docs|documentation|usage example/i.test(
          `${item.intent} ${item.quote}`,
        ),
      ),
  },
  {
    id: "intent-alarm-buckets-empty",
    description:
      "no alarm fires on a straightforwardly-delivered ticket: the diff opposes nothing and masks nothing, so deviations and maskedFixes stay empty",
    check: (brief) =>
      (brief.intentCheck?.deviations ?? []).length === 0 &&
      (brief.intentCheck?.maskedFixes ?? []).length === 0,
  },
  {
    id: "alignment-partial",
    description:
      "three of the four asks land, the docs-site example does not: the alignment read is partial",
    check: (brief) => brief.intentCheck?.alignment?.read === "partial",
  },
  {
    id: "alignment-goal-and-response",
    description:
      "the read carries a goal (the validator drops any that is not a verbatim span of the ticket) and one response sentence",
    check: (brief) =>
      (brief.intentCheck?.alignment?.goal ?? "").length > 0 &&
      (brief.intentCheck?.alignment?.response ?? "").trim().length > 0,
  },
];
