import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button, ButtonSizes } from "@web/components/Button";
import type { GuestRowReason } from "../../../../../model/types";
import { GUEST_REASON_KEYS } from "../consts";
import type { UnderRowLayout } from "../types";
import { UnderRow } from "../UnderRow";
import styles from "./ReasonRow.module.scss";

export interface ReasonRowProps {
  layout: UnderRowLayout;
  reason: GuestRowReason;
  onClose: () => void;
}

/**
 * Focus lands on Close when the row opens; Escape or Close hands it back
 * to the row.
 */
export function ReasonRow({ layout, reason, onClose }: ReasonRowProps) {
  const { t } = useTranslation();
  const textId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Escape") {
      return;
    }
    event.stopPropagation();
    onClose();
  };

  return (
    <UnderRow layout={layout}>
      <div className={styles["reason"]} data-testid="reason-row">
        <p className={styles["text"]} id={textId}>
          {t(GUEST_REASON_KEYS[reason])}
        </p>
        <Button
          aria-describedby={textId}
          onClick={onClose}
          onKeyDown={handleKeyDown}
          ref={closeRef}
          size={ButtonSizes.SM}
        >
          {t("brief.diff.guest.close")}
        </Button>
      </div>
    </UnderRow>
  );
}
