import { useTranslation } from "react-i18next";
import type { GenerationFailureCode } from "../../../types";
import { failureLine } from "./utils";
import cardStyles from "../stateCard.module.scss";

export interface FailedCardProps {
  /** Null when the code is absent or one this bundle doesn't know. */
  errorCode: GenerationFailureCode | null;
  /** Sanitized detail for the two codes that carry one. */
  errorDetail: string | null;
  attempts: number;
}

export function FailedCard({
  errorCode,
  errorDetail,
  attempts,
}: FailedCardProps) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="failed-heading" className={cardStyles["card"]}>
      <h1 className={cardStyles["heading"]} id="failed-heading">
        {t("pulls.failed.heading")}
      </h1>
      <p className={cardStyles["copy"]}>
        {/* Sanitized at write time (first line, URLs redacted, capped). */}
        {failureLine(t, errorCode, errorDetail)}
      </p>
      <p className={cardStyles["meta"]}>
        {t("pulls.failed.attempts", { count: attempts + 1 })}{" "}
        {t("pulls.failed.requeueNote")}
      </p>
    </section>
  );
}
