import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { Modal } from "@web/components/Modal";
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
      <Modal.Header
        close={close}
        detail={t("review.submit.receiptSub")}
        headingRef={headingRef}
        id="submit-modal-heading"
        title={t("review.submit.receiptHeading")}
        titleAside={
          <span className={styles["tag"]}>
            {t("review.submit.notAnApproval")}
          </span>
        }
      />
      <div className={styles["receiptBody"]} data-testid="receipt-body">
        <ReceiptAccordion
          outcome={outcome}
          rawLines={rawLines}
          receipt={receipt}
          signatureLine={signatureLine}
        />
      </div>
      <Modal.Footer>
        <Button onClick={backToVerdict}>
          {t("review.submit.backToVerdict")}
        </Button>
        <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
      </Modal.Footer>
    </>
  );
}
