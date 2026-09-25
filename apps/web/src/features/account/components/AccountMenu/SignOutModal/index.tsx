import { FloatingPortal } from "@floating-ui/react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button, ButtonVariants } from "@web/components/Button";
import { Modal } from "@web/components/Modal";
import modalStyles from "@web/components/Modal/Modal.module.scss";
import {
  SignOutScopes,
  type SignOutFlow,
  type SignOutScope,
} from "../../../types";
import styles from "./SignOutModal.module.scss";

export interface SignOutModalProps {
  flow: SignOutFlow;
  cancel: () => void;
  confirm: (scope: SignOutScope) => void;
}

const HEADING_ID = "sign-out-modal-heading";

/**
 * The confirm before a sign out: this device, or everywhere. Focus lands on
 * Cancel; while a request runs Escape and all three buttons hold, and a
 * refusal reports inside the box.
 */
export function SignOutModal({ flow, cancel, confirm }: SignOutModalProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const busy = flow.pending !== undefined;
  const close = busy ? undefined : cancel;
  const everywhereBusy = flow.pending === SignOutScopes.EVERYWHERE;
  const thisDeviceBusy = flow.pending === SignOutScopes.THIS_DEVICE;
  const signingOut = t("shell.signOutModal.signingOut");
  const everywhereLabel = everywhereBusy
    ? signingOut
    : t("shell.signOutModal.everywhere");
  const thisDeviceLabel = thisDeviceBusy
    ? signingOut
    : t("shell.signOutModal.thisDevice");

  // Portalled out of the header: its backdrop-filter would otherwise contain
  // the fixed overlay to the header box.
  return (
    <FloatingPortal>
      <Modal
        close={close}
        initialFocus={cancelRef}
        labelledBy={HEADING_ID}
        open={flow.open}
      >
        <h2 id={HEADING_ID}>{t("shell.signOutModal.heading")}</h2>
        <p className={modalStyles["copy"]}>{t("shell.signOutModal.copy")}</p>
        {flow.failed ? (
          <p className={styles["failed"]} role="alert">
            {t("shell.signOutModal.failed")}
          </p>
        ) : null}
        <div className={modalStyles["actions"]}>
          <Button disabled={busy} ref={cancelRef} onClick={cancel}>
            {t("shell.signOutModal.cancel")}
          </Button>
          <Button
            disabled={busy}
            loading={everywhereBusy}
            variant={ButtonVariants.DANGER}
            onClick={() => confirm(SignOutScopes.EVERYWHERE)}
          >
            {everywhereLabel}
          </Button>
          <Button
            disabled={busy}
            loading={thisDeviceBusy}
            variant={ButtonVariants.ACCENT}
            onClick={() => confirm(SignOutScopes.THIS_DEVICE)}
          >
            {thisDeviceLabel}
          </Button>
        </div>
      </Modal>
    </FloatingPortal>
  );
}
