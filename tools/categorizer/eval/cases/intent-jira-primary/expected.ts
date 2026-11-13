import type { EvalProperty } from "../../properties";

/**
 * The intent-precise-ticket PR and asks with the ticket held in a Jira issue:
 * the summary leads the tracker header, the body opens on a `Parent:` line.
 * `jira-issue.json` is a hand-written response in the shape Jira Cloud
 * answers in, not one recorded from a live site; a test reads it through the
 * production Jira read and holds the fixture's primary equal to the result.
 */
export const ISSUE_URL = "https://acme.atlassian.net/browse/DS-42";
export const ISSUE_TITLE = "Copy-to-clipboard button for the design system";

export const properties: EvalProperty[] = [
  {
    id: "intent-precise",
    description:
      "an actionable Jira issue + descriptive PR body reads as precise specificity",
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
    id: "intent-accomplished-anchored",
    description:
      "at least one accomplished ask, and every accomplished ask carries a group anchor",
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
      "no alarm fires on a straightforwardly-delivered ticket: deviations and maskedFixes stay empty",
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
      "the read carries a goal (the validator drops any that is not a verbatim span of the header and body) and one response sentence",
    check: (brief) =>
      (brief.intentCheck?.alignment?.goal ?? "").length > 0 &&
      (brief.intentCheck?.alignment?.response ?? "").trim().length > 0,
  },
  {
    id: "primary-title-from-header",
    description:
      "the title at the issue's ticketUrls position is the issue summary alone, never the header line or the parent line",
    check: (brief) => {
      const urls = brief.intentCheck?.ticketUrls ?? [];
      const position = urls.indexOf(ISSUE_URL);
      const title = brief.intentCheck?.ticketTitles[position] ?? "";
      return position >= 0 && title.trim() === ISSUE_TITLE;
    },
  },
];
