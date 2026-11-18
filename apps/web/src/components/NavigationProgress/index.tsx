import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { NAVIGATION_NOTICE_DELAY, NAVIGATION_NOTICE_DELAY_MS } from "./consts";
import styles from "./NavigationProgress.module.scss";

const BAR_STYLE: CSSProperties & {
  "--notice-delay": typeof NAVIGATION_NOTICE_DELAY;
} = {
  "--notice-delay": NAVIGATION_NOTICE_DELAY,
};

/**
 * A thin bar for a navigation slow enough to notice, and one polite line for
 * a screen reader on the same delay. The line is said once per navigation and
 * stays mounted, since a region inserted with its text is never read.
 */
export function NavigationProgress() {
  const { t } = useTranslation();
  const pending = useRouterState({
    select: (state) => state.status === "pending",
  });
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!pending) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setSlow(true);
    }, NAVIGATION_NOTICE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      setSlow(false);
    };
  }, [pending]);

  const notice = slow ? t("shell.navigating") : "";

  return (
    <>
      <p aria-live="polite" className="sr-only" role="status">
        {notice}
      </p>
      {pending ? (
        <div
          aria-hidden="true"
          className={styles["bar"]}
          data-testid="navigation-progress"
          style={BAR_STYLE}
        />
      ) : null}
    </>
  );
}
