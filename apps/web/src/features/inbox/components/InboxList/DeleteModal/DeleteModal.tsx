import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button, ButtonVariants } from "@web/components/Button/Button";
import { Modal } from "@web/components/Modal/Modal";
import modalStyles from "@web/components/Modal/Modal.module.scss";
import type { InboxItem } from "../../../types";
import styles from "./DeleteModal.module.scss";

export interface DeleteModalProps {
  /** The rows about to go; one names itself, several are counted and listed. */
  items: readonly InboxItem[];
  open: boolean;
  /** The delete is in flight: Escape and both buttons hold. */
  busy: boolean;
  cancel: () => void;
  confirm: () => void;
}

/**
 * The confirm before a delete. Focus lands on Cancel, the safe default for
 * a destructive dialog; the body names the cascade so the reviewer knows
 * what goes with the briefs.
 */
export function DeleteModal({
  items,
  open,
  busy,
  cancel,
  confirm,
}: DeleteModalProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const first = items[0];
  const count = items.length;
  const heading =
    count === 1
      ? t("home.inbox.deleteModal.heading", {
          number: first?.prNumber ?? 0,
          repo: first?.repoSlug ?? first?.repoId ?? "",
        })
      : t("home.inbox.deleteModal.headingMany", { count });
  const confirmLabel = busy
    ? t("home.inbox.deleteModal.deleting")
    : t("home.inbox.deleteModal.confirm");
  const close = busy ? undefined : cancel;

  return (
    <Modal
      close={close}
      initialFocus={cancelRef}
      labelledBy="inbox-delete-modal-heading"
      open={open}
    >
      <h2 id="inbox-delete-modal-heading">{heading}</h2>
      <p className={modalStyles["copy"]}>
        {t("home.inbox.deleteModal.cascade", { count })}
      </p>
      {count > 1 ? (
        <ul className={styles["rows"]}>
          {items.map((item) => (
            <li
              className={styles["row"]}
              key={`${item.repoId}/${item.prNumber}/${item.source}`}
            >
              {t("home.inbox.deleteModal.row", {
                number: item.prNumber,
                repo: item.repoSlug ?? item.repoId,
                title: item.title ?? "",
              })}
            </li>
          ))}
        </ul>
      ) : null}
      <div className={modalStyles["actions"]}>
        <Button disabled={busy} ref={cancelRef} onClick={cancel}>
          {t("home.inbox.deleteModal.cancel")}
        </Button>
        <Button
          disabled={busy}
          loading={busy}
          variant={ButtonVariants.DANGER}
          onClick={confirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
