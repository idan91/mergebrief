import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, ButtonVariants } from "@web/components/Button";
import { Modal } from "@web/components/Modal";
import type { InboxItem } from "../../../types";
import styles from "./PurgeAttachmentsModal.module.scss";

export interface PurgeAttachmentsModalProps {
  /** The row that asked; its repository is the one whose branch goes. */
  item: InboxItem;
  /** The delete is in flight: Escape and both buttons hold. */
  busy: boolean;
  cancel: () => void;
  confirm: () => void;
}

/**
 * The confirm before an attachment-branch delete. The consequence is
 * named first, then the reviewer types the repository's name: the branch
 * breaks images in comments already on GitHub, so a click alone is not
 * enough. Focus lands on Cancel, the safe default. The list mounts it only
 * while a purge is pending, so the typed name never outlives one ask.
 */
export function PurgeAttachmentsModal({
  item,
  busy,
  cancel,
  confirm,
}: PurgeAttachmentsModalProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const repo = item.repoSlug ?? item.repoId;
  const matches = typed.trim() === repo;
  const confirmLabel = busy
    ? t("home.inbox.purgeModal.deleting")
    : t("home.inbox.purgeModal.confirm");
  const close = busy ? undefined : cancel;

  function submit(): void {
    if (matches && !busy) {
      confirm();
    }
  }

  return (
    <Modal
      close={close}
      initialFocus={cancelRef}
      labelledBy="inbox-purge-modal-heading"
      open
    >
      <Modal.Header
        close={close}
        detail={
          <>
            {t("home.inbox.purgeModal.consequence")}{" "}
            {t("home.inbox.purgeModal.irreversible")}
          </>
        }
        id="inbox-purge-modal-heading"
        title={t("home.inbox.purgeModal.heading", { repo })}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className={styles["field"]} htmlFor={inputId}>
          <span>{t("home.inbox.purgeModal.confirmLabel", { repo })}</span>
          <input
            autoComplete="off"
            id={inputId}
            onChange={(event) => setTyped(event.target.value)}
            readOnly={busy}
            spellCheck={false}
            type="text"
            value={typed}
          />
        </label>
        <Modal.Footer>
          <Button
            disabled={busy}
            ref={cancelRef}
            onClick={cancel}
            type="button"
          >
            {t("home.inbox.purgeModal.cancel")}
          </Button>
          <Button
            disabled={!matches || busy}
            loading={busy}
            type="submit"
            variant={ButtonVariants.DANGER}
          >
            {confirmLabel}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
