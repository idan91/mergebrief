import { ProductDiffAvailabilities } from "brief-core/types";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import {
  makeProductChange,
  makeProductDiff,
} from "../../../../test-utils/fixtures";
import {
  capitalizeCondition,
  describeProductDiff,
  getChangeItemKey,
  hasOwnConnective,
  isProductDiffAvailable,
  stripWhenLead,
} from "./utils";

/** Answers with the key and its count, so a test reads which line was picked. */
function stubTranslate(): TFunction {
  return ((key: string, options?: { count?: number }) =>
    options?.count === undefined
      ? key
      : `${key}:${String(options.count)}`) as TFunction;
}

const twoChanges = [
  makeProductChange(),
  makeProductChange({ when: "a user saves" }),
];

describe("describeProductDiff", () => {
  it("counts the listed changes", () => {
    const line = describeProductDiff(
      stubTranslate(),
      makeProductDiff({ changes: twoChanges }),
    );

    expect(line).toBe("brief.productDiff.summary:2");
  });

  it("picks the starred count when the PR has more", () => {
    const productDiff = makeProductDiff({ changes: twoChanges, hasMore: true });

    const line = describeProductDiff(stubTranslate(), productDiff);

    expect(line).toBe("brief.productDiff.summaryMore:2");
  });

  it("says none found for an available section with no change", () => {
    const productDiff = makeProductDiff({ changes: [] });

    const line = describeProductDiff(stubTranslate(), productDiff);

    expect(line).toBe("brief.productDiff.noneFound");
  });

  it("says not available whatever the section lists", () => {
    const productDiff = makeProductDiff({
      availability: ProductDiffAvailabilities.UNAVAILABLE,
    });

    const line = describeProductDiff(stubTranslate(), productDiff);

    expect(line).toBe("brief.productDiff.unavailable");
    expect(isProductDiffAvailable(productDiff)).toBe(false);
  });
});

describe("getChangeItemKey", () => {
  it("tells apart two rows that share a condition", () => {
    const restored = makeProductChange({ after: "the item is restored" });
    const renamed = makeProductChange({ after: "the item is renamed" });

    expect(getChangeItemKey(restored)).not.toBe(getChangeItemKey(renamed));
  });
});

describe("stripWhenLead", () => {
  it("drops a leading when in either case", () => {
    expect(stripWhenLead("when a user signs in")).toBe("a user signs in");
    expect(stripWhenLead("When a user signs in")).toBe("a user signs in");
  });

  it("keeps a condition that only starts with those letters", () => {
    expect(stripWhenLead("whenever a job retries")).toBe(
      "whenever a job retries",
    );
    expect(stripWhenLead("a user signs in")).toBe("a user signs in");
  });
});

describe("hasOwnConnective", () => {
  it("is true for a flag-gated condition", () => {
    expect(hasOwnConnective("with the `beta` flag on, a user signs in")).toBe(
      true,
    );
    expect(hasOwnConnective("With the `beta` flag on, a user signs in")).toBe(
      true,
    );
  });

  it.each([
    "if a user has no session",
    "after a retry fails",
    "before the first sync",
    "once the import ends",
    "whenever a webhook arrives",
    "while a job is running",
    "unless the repo is archived",
    "until the token expires",
  ])("is true for a clause opening on its own conjunction: %s", (condition) => {
    expect(hasOwnConnective(condition)).toBe(true);
  });

  it("is false for a plain clause, even one starting with those letters", () => {
    expect(hasOwnConnective("a user signs in")).toBe(false);
    expect(hasOwnConnective("withdrawals above the limit are sent")).toBe(
      false,
    );
    expect(hasOwnConnective("iframes load before the page")).toBe(false);
    expect(hasOwnConnective("onceover checks run")).toBe(false);
  });
});

describe("capitalizeCondition", () => {
  it("uppercases the first letter and leaves the rest", () => {
    expect(capitalizeCondition("with the `beta` flag on")).toBe(
      "With the `beta` flag on",
    );
  });
});
