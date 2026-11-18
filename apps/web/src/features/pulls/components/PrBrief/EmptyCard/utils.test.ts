import { describe, expect, it } from "vitest";
import { PrStates } from "types";
import { appI18n } from "../../../../../i18n/I18nProvider";
import { buildEmptyCopyOverride, type EmptyCopyFacts } from "./utils";

const t = appI18n.t;
const OPEN_INSTALLED: EmptyCopyFacts = {
  appInstalled: true,
  prState: PrStates.OPEN,
  awaitsReadyForReview: false,
  draftsOffNotice: undefined,
};
const AWAITS_READY = t("pulls.empty.awaitsReadyCopy");
const NOT_OPEN = t("pulls.empty.notOpenCopy");
const AUTHOR_NOTICE = "The author's own drafts-off notice.";

interface OverrideCase {
  readonly name: string;
  readonly facts: EmptyCopyFacts;
  readonly expected: string | undefined;
}

const CASES: readonly OverrideCase[] = [
  {
    name: "an open PR keeps the default",
    facts: OPEN_INSTALLED,
    expected: undefined,
  },
  {
    name: "a skipped draft points any viewer at ready for review",
    facts: { ...OPEN_INSTALLED, awaitsReadyForReview: true },
    expected: AWAITS_READY,
  },
  {
    name: "a skipped draft's author reads their own notice",
    facts: {
      ...OPEN_INSTALLED,
      awaitsReadyForReview: true,
      draftsOffNotice: AUTHOR_NOTICE,
    },
    expected: AUTHOR_NOTICE,
  },
  {
    name: "a merged PR promises no brief, a skipped draft included",
    facts: {
      ...OPEN_INSTALLED,
      prState: PrStates.MERGED,
      awaitsReadyForReview: true,
      draftsOffNotice: AUTHOR_NOTICE,
    },
    expected: NOT_OPEN,
  },
  {
    name: "a url row keeps the default, which names installed repositories",
    facts: {
      ...OPEN_INSTALLED,
      appInstalled: false,
      prState: PrStates.CLOSED,
      awaitsReadyForReview: true,
    },
    expected: undefined,
  },
];

describe("buildEmptyCopyOverride", () => {
  it.each(CASES)("$name", ({ facts, expected }) => {
    expect(buildEmptyCopyOverride(t, facts)).toBe(expected);
  });
});
