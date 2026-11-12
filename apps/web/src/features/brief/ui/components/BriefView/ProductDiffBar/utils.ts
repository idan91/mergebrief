import type { TFunction } from "i18next";

import {
  ProductDiffAvailabilities,
  type ProductChange,
  type ProductDiff,
} from "brief-core/types";

export function isProductDiffAvailable(productDiff: ProductDiff): boolean {
  return productDiff.availability === ProductDiffAvailabilities.AVAILABLE;
}

/** A row's list key: the pipeline keeps no two rows with one condition and outcome. */
export function getChangeItemKey(change: ProductChange): string {
  return `${change.when}::${change.after}`;
}

/** The bar's quiet line: the count, "none found" or "not available". */
export function describeProductDiff(
  t: TFunction,
  productDiff: ProductDiff,
): string {
  if (!isProductDiffAvailable(productDiff)) {
    return t("brief.productDiff.unavailable");
  }

  const count = productDiff.changes.length;
  if (count === 0) {
    return t("brief.productDiff.noneFound");
  }
  if (productDiff.hasMore) {
    return t("brief.productDiff.summaryMore", { count });
  }
  return t("brief.productDiff.summary", { count });
}
