import type { EvalProperty } from "../../properties";

/**
 * The precise-ticket case with two unfetched references beside the primary:
 * a parent epic key (DS-40) and a bare #12, both plain text in the body.
 * Only DS-42 is injected. The alignment read must quote the primary, not the
 * epic wording, and ticketUrls must stay exactly the primary.
 */
const TICKET_URL = "https://tasks.example/DS-42";

export const properties: EvalProperty[] = [
  {
    id: "intent-ticket-url-bound",
    description:
      "ticketUrls is exactly the injected primary (the epic key and #12 are never invented into it)",
    check: (brief) =>
      brief.intentCheck !== undefined &&
      brief.intentCheck.ticketUrls.length === 1 &&
      brief.intentCheck.ticketUrls[0] === TICKET_URL,
  },
  {
    id: "alignment-present-partial",
    description:
      "three of the four asks are delivered: the read is partial (a docs-site example is missing)",
    check: (brief) => brief.intentCheck?.alignment?.read === "partial",
  },
  {
    id: "alignment-goal-from-primary",
    description:
      "the goal is quoted from the primary ticket (copy button), not from the epic wording",
    check: (brief) => {
      const goal = brief.intentCheck?.alignment?.goal ?? "";
      return /copy|clipboard/i.test(goal) && !/epic|primitives/i.test(goal);
    },
  },
  {
    id: "alignment-response-nonempty",
    description: "the response is one factual sentence about the diff",
    check: (brief) =>
      (brief.intentCheck?.alignment?.response ?? "").trim().length > 0,
  },
];
