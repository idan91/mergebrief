import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import briefPage from "../../assets/brief-page.png";
import { Icon } from "@web/components/Icon";
import { IconNames } from "@web/components/Icon/types";
import styles from "./SignedOutHome.module.scss";

const SIGN_IN_PATH = "/api/auth/github";
const PICTURE_WIDTH = 1440;
const PICTURE_HEIGHT = 900;

/** The pitch a visitor sees before signing in: one claim, one picture of a brief, Sign in. */
export function SignedOutHome() {
  const { t } = useTranslation();

  return (
    <div className={styles["signedOut"]}>
      <div className={styles["copy"]}>
        <h1 className={styles["heading"]}>{t("home.signedOut.heading")}</h1>
        <p className={styles["lead"]}>{t("home.signedOut.copy")}</p>
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
