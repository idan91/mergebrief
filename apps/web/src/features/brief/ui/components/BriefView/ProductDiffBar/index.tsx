import { useTranslation } from "react-i18next";
import { useState } from "react";

import type { ProductDiff } from "brief-core/types";
import { CollapsibleBar } from "@web/components/CollapsibleBar";
import { BarHeadingLevels } from "@web/components/CollapsibleBar/types";
import { ProductChangeItem } from "./ProductChangeItem";
import styles from "./ProductDiffBar.module.scss";
import {
  describeProductDiff,
  getChangeItemKey,
  isProductDiffAvailable,
} from "./utils";

export interface ProductDiffBarProps {
  productDiff: ProductDiff;
  jumpToGroup: (groupId: string) => void;
  groupTitles: Readonly<Record<string, string>>;
}

/**
 * How the product behaves before the PR and after it, one split strip per
 * Product change. Collapsed until the reader opens it, like the Intent
 * check: an AI read never opens itself.
 */
export function ProductDiffBar({
  productDiff,
  jumpToGroup,
  groupTitles,
}: ProductDiffBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const summary = describeProductDiff(t, productDiff);
  const { changes } = productDiff;
  const isAvailable = isProductDiffAvailable(productDiff);
  const hasChanges = isAvailable && changes.length > 0;
  const emptyNote = isAvailable
    ? t("brief.productDiff.noneNote")
    : t("brief.productDiff.unavailableNote");

  return (
    <CollapsibleBar
      data-testid="product-diff-bar"
      headingLevel={BarHeadingLevels.H2}
      open={open}
      summary={summary}
      title={t("brief.productDiff.title")}
      onToggle={() => setOpen((value) => !value)}
    >
      {hasChanges ? (
        <>
          <ol className={styles["changes"]}>
            {changes.map((change) => (
              <ProductChangeItem
                change={change}
                groupTitles={groupTitles}
                jumpToGroup={jumpToGroup}
                key={getChangeItemKey(change)}
              />
            ))}
          </ol>
          {productDiff.hasMore ? (
            <p className={styles["moreNote"]}>
              {t("brief.productDiff.moreNote")}
            </p>
          ) : null}
        </>
      ) : (
        <p className={styles["emptyNote"]}>{emptyNote}</p>
      )}
      {isAvailable ? (
        <p className={styles["caution"]}>{t("brief.inferenceCaution")}</p>
      ) : null}
    </CollapsibleBar>
  );
}
