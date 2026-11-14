import type { TFunction } from "i18next";

import {
  ProductDiffAvailabilities,
  type ProductChange,
  type ProductDiff,
} from "brief-core/types";

const WHEN_LEAD_PATTERN = /^when\s+/i;
const OWN_CONNECTIVE_PATTERN =
  /^(?:with|if|after|before|once|whenever|while|unless|until)\s/i;

/** The condition without a "when" of its own: the heading supplies the lead-in. */
export function stripWhenLead(condition: string): string {
  return condition.replace(WHEN_LEAD_PATTERN, "");
}

/**
 * Whether the condition opens with a connective of its own, the way a
 * flag-gated one is written ("with the X flag on, ...") or one carrying
 * its own conjunction ("after a retry, ..."): the heading then reads as
 * written, without the lead-in.
 */
export function hasOwnConnective(condition: string): boolean {
  return OWN_CONNECTIVE_PATTERN.test(condition);
}

export function capitalizeCondition(condition: string): string {
  return condition.charAt(0).toUpperCase() + condition.slice(1);
}

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
