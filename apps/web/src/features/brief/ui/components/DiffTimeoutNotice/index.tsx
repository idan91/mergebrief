import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button, ButtonSizes } from "@web/components/Button";
import type { DiffFetchRetry } from "./types";
import styles from "./DiffTimeoutNotice.module.scss";

export interface DiffTimeoutNoticeProps {
  retry: DiffFetchRetry;
}

/**
 * The sentence is its own alert, so mounting announces it and a failed retry
 * re-mounts it to announce again, without moving focus off the button. The
 * layout cleanup runs before React detaches the node, so it still sees the
 * focus this notice is about to drop.
 */
export function DiffTimeoutNotice({ retry }: DiffTimeoutNoticeProps) {
  const { t } = useTranslation();
  const noticeRef = useRef<HTMLDivElement>(null);
  const releaseFocusRef = useRef(retry.releaseFocus);
  useLayoutEffect(() => {
    releaseFocusRef.current = retry.releaseFocus;
  });
  useLayoutEffect(() => {
    const notice = noticeRef.current;
    return () => {
      if (notice?.contains(document.activeElement) === true) {
        releaseFocusRef.current();
      }
    };
  }, []);
  const label = retry.pending
    ? t("brief.diff.timeoutRetryPending")
    : t("brief.diff.timeoutRetry");

  return (
    <div
      className={styles["notice"]}
      data-testid="diff-timeout-notice"
      ref={noticeRef}
    >
      <p className={styles["detail"]} key={retry.failureCount} role="alert">
        {t("pulls.briefError.diff-fetch-timeout")}
      </p>
      <Button
        loading={retry.pending}
        onClick={retry.retry}
        size={ButtonSizes.SM}
        type="button"
      >
        {label}
      </Button>
    </div>
  );
}
