import { ProductDiffAvailabilities } from "brief-core/types";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import {
  makeProductChange,
  makeProductDiff,
} from "../../../../test-utils/fixtures";
import {
  describeProductDiff,
  getChangeItemKey,
  isProductDiffAvailable,
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
