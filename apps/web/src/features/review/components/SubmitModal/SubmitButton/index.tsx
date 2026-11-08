import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import type { SubmitAffordance } from "../types";

export interface SubmitButtonProps {
  submit: SubmitAffordance;
}

/** Off stays focusable and clickable: a click is the try that shows why. */
export function SubmitButton({ submit }: SubmitButtonProps) {
  const { t } = useTranslation();
  const ariaDisabled = submit.disabled ? true : undefined;
  const label = submit.pending
    ? t("review.submit.submitting")
    : t("review.submit.submitReview");

  return (
    <Button
      aria-describedby={submit.describedBy}
      aria-disabled={ariaDisabled}
      loading={submit.pending}
      variant="primary"
      onClick={submit.attempt}
    >
      {label}
    </Button>
  );
}
