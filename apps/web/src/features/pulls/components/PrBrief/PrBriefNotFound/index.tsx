import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { StatePage } from "@web/components/StatePage";
import { AccountMenu } from "@web/features/account";

/**
 * One page for a pull request that is gone and one this viewer cannot see:
 * the API answers both with the same 404, so the copy names both causes and
 * echoes nothing from the address.
 */
export function PrBriefNotFound() {
  const { t } = useTranslation();

  return (
    <StatePage
      action={
        <Button as="a" href="/">
          {t("shell.notFound.home")}
        </Button>
      }
      detail={t("pulls.notFound.detail")}
      heading={t("pulls.notFound.heading")}
      headerEnd={<AccountMenu />}
    />
  );
}
