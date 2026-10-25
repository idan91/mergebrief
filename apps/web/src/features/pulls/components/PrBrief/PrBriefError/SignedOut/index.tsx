import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { Icon } from "@web/components/Icon";
import { IconNames } from "@web/components/Icon/types";
import { StatePage } from "@web/components/StatePage";
import { buildSignInHref } from "@web/data/sign-in";
import styles from "./SignedOut.module.scss";

export interface SignedOutProps {
  /** The page to land back on after GitHub; absent signs in to Home. */
  returnTo?: string | undefined;
}

/**
 * The PR page for a viewer with no session. The Header carries no Account
 * menu here: its Sign in would land on Home, beside one that returns here.
 */
export function SignedOut({ returnTo }: SignedOutProps) {
  const { t } = useTranslation();
  const href = buildSignInHref(returnTo);

  return (
    <StatePage
      action={
        <Button
          as="a"
          className={styles["signIn"]}
          href={href}
          variant="accent"
        >
          <Icon name={IconNames.GITHUB_LOGO} />
          {t("pulls.errorBoundary.signIn")}
        </Button>
      }
      detail={t("pulls.signIn.detail")}
      heading={t("pulls.signIn.heading")}
    />
  );
}
