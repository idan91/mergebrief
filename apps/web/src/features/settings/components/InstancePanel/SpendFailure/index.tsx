import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { FailureBlock } from "@web/components/FailureBlock";
import { useAnnouncer } from "@web/hooks/useAnnouncer";
import styles from "./SpendFailure.module.scss";

export interface SpendFailureProps {
  /** Ask again; resolves true once the read settled as a count or a refusal. */
  onRetry: () => Promise<boolean>;
  /** Stable across renders: the cleanup that calls it must run only on unmount. */
  onFocusHandOff: () => void;
}

/**
 * The read that failed. A retry that fails again is announced anew and keeps
 * focus on the button. Leaving while it holds focus, by a retry or a poll, it
 * hands focus off; a layout cleanup runs before React detaches its nodes.
 */
export function SpendFailure({ onRetry, onFocusHandOff }: SpendFailureProps) {
  const { t } = useTranslation();
  const announcer = useAnnouncer();
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const detail = t("spend.loadFailedDetail");

  useLayoutEffect(() => {
    const root = rootRef.current;
    return () => {
      if (root?.contains(document.activeElement)) {
        onFocusHandOff();
      }
    };
  }, [onFocusHandOff]);

  async function retry(): Promise<void> {
    setPending(true);
    let settled = false;
    try {
      settled = await onRetry();
    } catch {
      settled = false;
    } finally {
      setPending(false);
    }
    if (!settled) {
      announcer.announce(detail);
    }
  }

  return (
    <div ref={rootRef}>
      <FailureBlock
        detail={detail}
        heading={<h2 className={styles["heading"]}>{t("spend.loadFailed")}</h2>}
        pending={pending}
        retryLabel={t("spend.retry")}
        onRetry={() => {
          void retry();
        }}
      />
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {announcer.text}
      </p>
    </div>
  );
}
