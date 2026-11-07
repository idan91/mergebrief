import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@web/components/Button";
import { Modal } from "@web/components/Modal";
import type { DismissTarget } from "../../utils/state";
import styles from "@web/components/Modal/Modal.module.scss";

export interface DismissModalProps {
  target: DismissTarget | null;
  reason: string;
  warned: boolean;
  cancel: () => void;
  confirm: () => void;
  setReason: (reason: string) => void;
}

export function DismissModal({
  target,
  reason,
  warned,
  cancel,
  confirm,
  setReason,
}: DismissModalProps) {
  const { t } = useTranslation();
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <Modal
      open={Boolean(target)}
      close={cancel}
      initialFocus={reasonRef}
      labelledBy="dismiss-modal-heading"
    >
      <Modal.Header
        close={cancel}
        id="dismiss-modal-heading"
        title={t("review.dismiss.heading")}
      />
      <div className={styles["target"]}>{target?.label}</div>
      <textarea
        ref={reasonRef}
        aria-label={t("review.dismiss.reasonLabel")}
        suppressHydrationWarning
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={t("review.dismiss.reasonPlaceholder")}
      />
      {/* Conditionally rendered (not CSS-toggled) so its appearance is a DOM
          change role="alert" announces; visible timing is unchanged. */}
      {warned ? (
        <div className={styles["warn"]} data-state="visible" role="alert">
          {t("review.dismiss.thinWarning")}
        </div>
      ) : null}
      <Modal.Footer>
        <Button onClick={cancel}>{t("review.dismiss.cancel")}</Button>
        <Button variant="accent" onClick={confirm}>
          {warned
            ? t("review.dismiss.dismissAnyway")
            : t("review.dismiss.dismissWithReason")}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
