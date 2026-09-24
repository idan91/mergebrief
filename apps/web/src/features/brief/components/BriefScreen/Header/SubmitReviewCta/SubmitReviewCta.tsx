import { useTranslation } from "react-i18next";
import type { Ref } from "react";

import { Button } from "@web/components/Button/Button";
import styles from "./SubmitReviewCta.module.scss";

export interface SubmitReviewCtaProps {
  count: number;
  slotRef: Ref<HTMLButtonElement>;
  onBlur: () => void;
  onClick: () => void;
  onFocus: () => void;
}

export function SubmitReviewCta({
  count,
  slotRef,
  onBlur,
  onClick,
  onFocus,
}: SubmitReviewCtaProps) {
  const { t } = useTranslation();
  let ariaLabel: string | undefined;
  if (count > 0) {
    ariaLabel = t("brief.header.ariaLabelSubmitReview", { count });
  }

  return (
    <Button
      aria-label={ariaLabel}
      className={styles["cta"]}
      data-terminal-slot=""
      ref={slotRef}
      variant="accent"
      onBlur={onBlur}
      onClick={onClick}
      onFocus={onFocus}
    >
      <span>{t("brief.header.submitReviewCta")}</span>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className={styles["chip"]}
          data-testid="submit-count-chip"
        >
          {count}
        </span>
      ) : null}
    </Button>
  );
}
