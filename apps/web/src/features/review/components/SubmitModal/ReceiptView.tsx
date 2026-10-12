import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

import { Button } from "@web/components/Button";
import modalStyles from "@web/components/Modal/Modal.module.scss";
import { receiptText, type Receipt } from "../../utils/receipt";
import type { ReviewOutcome } from "types/reviews";
import { ReceiptAccordion } from "./ReceiptAccordion";
import styles from "./SubmitModal.module.scss";

export interface ReceiptViewProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  outcome: ReviewOutcome;
  receipt: Receipt;
  close: () => void;
  backToVerdict: () => void;
}

export function ReceiptView({
  headingRef,
  outcome,
  receipt,
  close,
  backToVerdict,
}: ReceiptViewProps) {
  const { t } = useTranslation();
  // Only this view mounts the receipt, so walking every comment and flag no
  // longer needs a guard against the parent's per-keystroke re-render.
  const raw = receiptText(receipt);
  return (
    <>
      <div className={styles["receiptTitle"]}>
        <h2 id="submit-modal-heading" ref={headingRef} tabIndex={-1}>
          {t("review.submit.receiptHeading")}
        </h2>
        <span className={styles["tag"]}>
          {t("review.submit.notAnApproval")}
        </span>
      </div>
      <p className={styles["sub"]}>{t("review.submit.receiptSub")}</p>
      <ReceiptAccordion outcome={outcome} raw={raw} receipt={receipt} />
      <div className={clsx(modalStyles["actions"], styles["actionsRow"])}>
        <Button onClick={backToVerdict}>
          {t("review.submit.backToVerdict")}
        </Button>
        <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
      </div>
    </>
  );
}
