import type { SignInFailure } from "contract";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { SIGN_IN_PATH } from "@web/data/sign-in";
import briefPage from "../../assets/brief-page.png";
import { Icon } from "@web/components/Icon";
import { IconNames } from "@web/components/Icon/types";
import { SIGN_IN_FAILURE_COPY_KEYS } from "./consts";
import styles from "./SignedOutHome.module.scss";

const PICTURE_WIDTH = 1440;
const PICTURE_HEIGHT = 900;

export interface SignedOutHomeProps {
  /** Why the last sign-in failed, when the visitor came back from one. */
  failure?: SignInFailure | undefined;
}

/** The pitch a visitor sees before signing in: one claim, one picture of a brief, Sign in. */
export function SignedOutHome({ failure }: SignedOutHomeProps) {
  const { t } = useTranslation();
  const failureCopy =
    failure === undefined ? undefined : t(SIGN_IN_FAILURE_COPY_KEYS[failure]);

  return (
    <div className={styles["signedOut"]}>
      <div className={styles["copy"]}>
        <h1 className={styles["heading"]}>{t("home.signedOut.heading")}</h1>
        <p className={styles["lead"]}>{t("home.signedOut.copy")}</p>
        {failureCopy === undefined ? null : (
          <p className={styles["failure"]} role="alert">
            {failureCopy}
          </p>
        )}
        <Button
          as="a"
          className={styles["signIn"]}
          href={SIGN_IN_PATH}
          variant="accent"
        >
          <Icon name={IconNames.GITHUB_LOGO} />
          {t("home.signedOut.signIn")}
        </Button>
      </div>
      <figure className={styles["picture"]}>
        <img
          alt={t("home.signedOut.pictureAlt")}
          fetchPriority="high"
          height={PICTURE_HEIGHT}
          src={briefPage}
          width={PICTURE_WIDTH}
        />
      </figure>
    </div>
  );
}
