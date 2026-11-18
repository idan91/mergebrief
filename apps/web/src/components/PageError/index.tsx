import { useTranslation } from "react-i18next";

import { Button } from "../Button";
import { StatePage } from "../StatePage";

/**
 * The screen for an error no route boundary of its own caught, the root's
 * included. Its copy reads nothing off the error: a message can carry a
 * request path.
 */
export function PageError() {
  const { t } = useTranslation();

  return (
    <StatePage
      action={
        <Button as="a" href="/">
          {t("shell.pageFailed.home")}
        </Button>
      }
      detail={t("shell.pageFailed.detail")}
      heading={t("shell.pageFailed.heading")}
    />
  );
}
