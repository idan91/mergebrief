import { useTranslation } from "react-i18next";

import { BeforeSources, type ProductChange } from "brief-core/types";
import { InlineCodeText } from "../../../InlineCodeText";
import styles from "./BeforeText.module.scss";

export interface BeforeTextProps {
  change: ProductChange;
}

/**
 * The before as stated, marked when it rests on the PR text. A change with
 * none gets a fixed line: the behaviour is new, or nothing showed it.
 */
export function BeforeText({ change }: BeforeTextProps) {
  const { t } = useTranslation();

  if (change.before === undefined) {
    const isNewBehaviour = change.beforeSource === BeforeSources.DID_NOT_EXIST;
    const absentLine = isNewBehaviour
      ? t("brief.productDiff.didNotExist")
      : t("brief.productDiff.notShown");
    return <span className={styles["absent"]}>{absentLine}</span>;
  }

  const isFromPrText = change.beforeSource === BeforeSources.PR_TEXT;
  return (
    <>
      <InlineCodeText text={change.before} />
      {isFromPrText ? (
        <>
          {" "}
          <span className={styles["sourceMark"]}>
            {t("brief.productDiff.perPrDescription")}
          </span>
        </>
      ) : null}
    </>
  );
}
