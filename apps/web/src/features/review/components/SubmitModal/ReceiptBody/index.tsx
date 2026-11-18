import type { ReviewOutcome } from "types/reviews";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Tabs } from "@web/components/Tabs";
import type { Receipt, ReceiptLine } from "../../../utils/receipt";
import { CommentList } from "./CommentList";
import { GenerationMetrics } from "./GenerationMetrics";
import { NotCheckedList } from "./NotCheckedList";
import { RawReceipt } from "./RawReceipt";
import { ReceiptTiles } from "./ReceiptTiles";
import { RiskDisposition } from "./RiskDisposition";
import { ReceiptSections, type ReceiptSection } from "./types";
import { isReceiptSection, pickFirstSection } from "./utils";
import styles from "./ReceiptBody.module.scss";

export interface ReceiptBodyProps {
  receipt: Receipt;
  outcome: ReviewOutcome | undefined;
  /** The frozen receipt's lines, shown in the raw tab. */
  rawLines: readonly ReceiptLine[];
  signatureLine?: string | undefined;
}

/** The receipt view's body: the outcome chip and the counts as tiles, then one section at a time. */
export function ReceiptBody({
  receipt,
  outcome,
  rawLines,
  signatureLine,
}: ReceiptBodyProps) {
  const { t } = useTranslation();
  const hasSignature = signatureLine !== undefined;
  const [section, setSection] = useState<ReceiptSection>(() =>
    pickFirstSection(receipt.counts.open, hasSignature),
  );
  const selectSection = (value: string) => {
    if (isReceiptSection(value)) {
      setSection(value);
    }
  };

  return (
    <div className={styles["stack"]}>
      <ReceiptTiles outcome={outcome} receipt={receipt} />
      <Tabs value={section} onValueChange={selectSection}>
        <Tabs.List
          className={styles["tabList"]}
          label={t("review.submit.receiptSections")}
        >
          {hasSignature ? (
            <Tabs.Tab value={ReceiptSections.SIGNATURE}>
              {t("review.submit.receiptTabSignature")}
            </Tabs.Tab>
          ) : null}
          <Tabs.Tab value={ReceiptSections.RISKS}>
            {t("review.submit.receiptTabRisks")}{" "}
            <span className={styles["count"]}>{receipt.counts.open}</span>
          </Tabs.Tab>
          <Tabs.Tab value={ReceiptSections.COMMENTS}>
            {t("review.submit.receiptTabComments")}{" "}
            <span className={styles["count"]}>{receipt.comments.length}</span>
          </Tabs.Tab>
          <Tabs.Tab value={ReceiptSections.NOT_CHECKED}>
            {t("review.summary.notCheckedHeading")}
          </Tabs.Tab>
          <Tabs.Tab value={ReceiptSections.RAW}>
            {t("review.submit.receiptTabRaw")}
          </Tabs.Tab>
        </Tabs.List>
        {hasSignature ? (
          <Tabs.Panel
            className={styles["panel"]}
            focusable
            value={ReceiptSections.SIGNATURE}
          >
            <p className={styles["signature"]}>{signatureLine}</p>
          </Tabs.Panel>
        ) : null}
        <Tabs.Panel
          className={styles["panel"]}
          focusable
          value={ReceiptSections.RISKS}
        >
          <RiskDisposition receipt={receipt} />
        </Tabs.Panel>
        <Tabs.Panel
          className={styles["panel"]}
          focusable
          value={ReceiptSections.COMMENTS}
        >
          <CommentList comments={receipt.comments} />
        </Tabs.Panel>
        <Tabs.Panel
          className={styles["panel"]}
          focusable
          value={ReceiptSections.NOT_CHECKED}
        >
          <NotCheckedList />
          {receipt.generation === undefined ? null : (
            <dl className={styles["metrics"]}>
              <GenerationMetrics generation={receipt.generation} />
            </dl>
          )}
        </Tabs.Panel>
        <Tabs.Panel
          className={styles["panel"]}
          focusable
          value={ReceiptSections.RAW}
        >
          <RawReceipt lines={rawLines} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
