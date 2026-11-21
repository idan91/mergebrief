import { describe, expect, it } from "vitest";
import { PrStates } from "types";
import { appI18n } from "../../../../../i18n/I18nProvider";
import { buildEmptyCopyOverride, type EmptyCopyFacts } from "./utils";

const t = appI18n.t;
const OPEN_INSTALLED: EmptyCopyFacts = {
  appInstalled: true,
  prState: PrStates.OPEN,
};
const NOT_OPEN = t("pulls.empty.notOpenCopy");

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
    name: "a merged PR promises no brief",
    facts: { ...OPEN_INSTALLED, prState: PrStates.MERGED },
    expected: NOT_OPEN,
  },
  {
    name: "a url row keeps the default, which names installed repositories",
    facts: { appInstalled: false, prState: PrStates.CLOSED },
    expected: undefined,
  },
];

describe("buildEmptyCopyOverride", () => {
  it.each(CASES)("$name", ({ facts, expected }) => {
    expect(buildEmptyCopyOverride(t, facts)).toBe(expected);
  });
});
