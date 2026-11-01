import type { EvalProperty } from "../../properties";

/**
 * The intent-precise-ticket diff and asks, read the way a GitHub issue
 * reaches production: no key, the title only in the tracker header
 * `title · state · labels`, and a body that never repeats it.
 * `primary-title-from-header` holds the model to the title piece, never
 * the whole header line. The issue is authored fixture data.
 */
export const ISSUE_URL = "https://github.com/Idan91/components/issues/42";
export const ISSUE_TITLE = "Copy-to-clipboard button for the design system";

export const properties: EvalProperty[] = [
  {
    id: "intent-precise",
    description:
      "an actionable issue body reads as precise, the precondition for an alignment read",
    check: (brief) => brief.intentCheck?.specificity === "precise",
  },
  {
    id: "intent-ticket-url-bound",
    description:
      "ticketUrls is exactly the injected issue URL (never invented, never dropped)",
    check: (brief) =>
      brief.intentCheck !== undefined &&
      brief.intentCheck.ticketUrls.length === 1 &&
      brief.intentCheck.ticketUrls[0] === ISSUE_URL,
  },
  {
    id: "alignment-goal-verifies",
    description:
      "an alignment read survives with a goal: the validator drops any read whose goal is not a verbatim span of the injected header and body",
    check: (brief) =>
      (brief.intentCheck?.alignment?.goal ?? "").trim().length > 0,
  },
  {
    id: "primary-title-from-header",
    description:
      "the title at the issue's ticketUrls position is the issue title alone, not the whole header line",
    check: (brief) => {
      const urls = brief.intentCheck?.ticketUrls ?? [];
      const position = urls.indexOf(ISSUE_URL);
      const title = brief.intentCheck?.ticketTitles[position] ?? "";
      return position >= 0 && title.trim() === ISSUE_TITLE;
    },
  },
];
