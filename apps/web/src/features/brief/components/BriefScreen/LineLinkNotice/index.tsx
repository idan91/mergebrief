import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import styles from "./LineLinkNotice.module.scss";

export interface LineLinkNoticeProps {
  onDismiss: () => void;
}

/** The band under the header for a line link this brief cannot land. */
export function LineLinkNotice({ onDismiss }: LineLinkNoticeProps) {
  const { t } = useTranslation();
  const messageId = useId();

  return (
    <div className={styles["notice"]} data-testid="line-link-notice">
      <span id={messageId}>{t("brief.lineLink.missing")}</span>
      <Button aria-describedby={messageId} onClick={onDismiss} variant="quiet">
        {t("brief.lineLink.dismiss")}
      </Button>
    </div>
  );
}
