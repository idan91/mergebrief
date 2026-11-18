import { SignInFailures, type SignInFailure } from "contract";
import { Trans, useTranslation } from "react-i18next";

import { OWNER_SETUP_CODE, SIGN_IN_FAILURE_COPY_KEYS } from "./consts";
import styles from "./FailureBox.module.scss";

export interface FailureBoxProps {
  failure: SignInFailure;
}

/** Why the last sign-in failed; a refused account also learns how an owner lets it in. */
export function FailureBox({ failure }: FailureBoxProps) {
  const { t } = useTranslation();
  const accountNotAllowed = failure === SignInFailures.NOT_ALLOWED;

  return (
    <div className={styles["box"]}>
      <p className={styles["why"]} role="alert">
        {t(SIGN_IN_FAILURE_COPY_KEYS[failure])}
      </p>
      {accountNotAllowed ? (
        <p className={styles["owner"]}>
          <Trans
            components={OWNER_SETUP_CODE}
            i18nKey="home.signedOut.accountNotAllowedOwner"
          />
        </p>
      ) : null}
    </div>
  );
}
