import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import {
  Chip,
  ChipElements,
  ChipTones,
  ChipVariants,
} from "@web/components/Chip";
import { Modal } from "@web/components/Modal";
import { listReceiptLines, type Receipt } from "../../utils/receipt";
import type { ReviewOutcome } from "types/reviews";
import { ReceiptBody } from "./ReceiptBody";
import { SubmitButton } from "./SubmitButton";
import { SubmitStatusLines } from "./SubmitStatusLines";
import type { SubmitAffordance, SubmitStatus } from "./types";
import styles from "./SubmitModal.module.scss";

export interface ReceiptViewProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  outcome: ReviewOutcome | undefined;
  receipt: Receipt;
  signatureLine?: string | undefined;
  submit: SubmitAffordance;
  status: SubmitStatus;
  /** Someone has tried Submit, so its blocked reason shows. */
  reasonShown: boolean;
  /** Set while a moved head waits for the acknowledgement the verdict view asks for. */
  staleWarning?: string | undefined;
  close: () => void;
  backToVerdict: () => void;
}

export function ReceiptView({
  headingRef,
  outcome,
  receipt,
  signatureLine,
  submit,
  status,
  reasonShown,
  staleWarning,
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
          <Chip
            as={ChipElements.SPAN}
            tone={ChipTones.MUTED}
            variant={ChipVariants.FACT}
          >
            {t("review.submit.notAnApproval")}
          </Chip>
        }
      />
      <div className={styles["receiptBody"]} data-testid="receipt-body">
        <ReceiptBody
          outcome={outcome}
          rawLines={rawLines}
          receipt={receipt}
          signatureLine={signatureLine}
        />
      </div>
      <Modal.Footer
        reason={
          <SubmitStatusLines
            reasonShown={reasonShown}
            staleWarning={staleWarning}
            status={status}
          />
        }
      >
        <Button onClick={backToVerdict}>{t("review.submit.back")}</Button>
        <SubmitButton submit={submit} />
      </Modal.Footer>
    </>
  );
}
