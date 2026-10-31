import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

import { Button } from "@web/components/Button";
import modalStyles from "@web/components/Modal/Modal.module.scss";
import { listReceiptLines, type Receipt } from "../../utils/receipt";
import type { ReviewOutcome } from "types/reviews";
import { ReceiptAccordion } from "./ReceiptAccordion";
import styles from "./SubmitModal.module.scss";

export interface ReceiptViewProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  outcome: ReviewOutcome | undefined;
  receipt: Receipt;
  signatureLine?: string | undefined;
  close: () => void;
  backToVerdict: () => void;
}

export function ReceiptView({
  headingRef,
  outcome,
  receipt,
  signatureLine,
  close,
  backToVerdict,
}: ReceiptViewProps) {
  const { t } = useTranslation();
  // Only this view mounts the receipt, so walking every comment and flag no
  // longer needs a guard against the parent's per-keystroke re-render.
  const rawLines = listReceiptLines(receipt);
  return (
    <>
      <div className={styles["receiptHead"]}>
        <div className={styles["receiptTitle"]}>
          <h2 id="submit-modal-heading" ref={headingRef} tabIndex={-1}>
            {t("review.submit.receiptHeading")}
          </h2>
          <span className={styles["tag"]}>
            {t("review.submit.notAnApproval")}
          </span>
        </div>
        <p className={styles["sub"]}>{t("review.submit.receiptSub")}</p>
      </div>
      <div className={styles["receiptBody"]} data-testid="receipt-body">
        <ReceiptAccordion
          outcome={outcome}
          rawLines={rawLines}
          receipt={receipt}
          signatureLine={signatureLine}
        />
      </div>
      <div className={clsx(modalStyles["actions"], styles["actionsRow"])}>
        <Button onClick={backToVerdict}>
          {t("review.submit.backToVerdict")}
        </Button>
        <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
      </div>
    </>
  );
}
