import { FloatingPortal } from "@floating-ui/react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button, ButtonVariants } from "@web/components/Button";
import { Modal } from "@web/components/Modal";
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

  // Portalled out of the header: its stacking context would otherwise cap the
  // overlay's z-index.
  return (
    <FloatingPortal>
      <Modal
        close={close}
        initialFocus={cancelRef}
        labelledBy={HEADING_ID}
        open={flow.open}
      >
        <Modal.Header
          close={close}
          detail={t("shell.signOutModal.copy")}
          id={HEADING_ID}
          title={t("shell.signOutModal.heading")}
        />
        <Modal.Footer
          reason={
            flow.failed ? (
              <p className={styles["failed"]} role="alert">
                {t("shell.signOutModal.failed")}
              </p>
            ) : undefined
          }
        >
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
            variant={ButtonVariants.PRIMARY}
            onClick={() => confirm(SignOutScopes.THIS_DEVICE)}
          >
            {thisDeviceLabel}
          </Button>
        </Modal.Footer>
      </Modal>
    </FloatingPortal>
  );
}
