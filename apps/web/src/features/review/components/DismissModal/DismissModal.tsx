import { useTranslation } from "react-i18next";
import { Modal } from "@web/components/Modal/Modal";
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
  return (
    <Modal
      open={Boolean(target)}
      close={cancel}
      labelledBy="dismiss-modal-heading"
    >
      <h3 id="dismiss-modal-heading">{t("review.dismiss.heading")}</h3>
      <div className={styles["target"]}>{target?.label}</div>
      <textarea
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
      <div className={styles["actions"]}>
        <button className="btn" type="button" onClick={cancel}>
          {t("review.dismiss.cancel")}
        </button>
        <button className="btn primary" type="button" onClick={confirm}>
          {warned
            ? t("review.dismiss.dismissAnyway")
            : t("review.dismiss.dismissWithReason")}
        </button>
      </div>
    </Modal>
  );
}
