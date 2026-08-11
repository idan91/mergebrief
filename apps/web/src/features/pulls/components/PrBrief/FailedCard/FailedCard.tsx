import { useTranslation } from "react-i18next";
import cardStyles from "../stateCard.module.scss";

export interface FailedCardProps {
  error: string | null;
  attempts: number;
}

export function FailedCard({ error, attempts }: FailedCardProps) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="failed-heading" className={cardStyles["card"]}>
      <h1 className={cardStyles["heading"]} id="failed-heading">
        {t("pulls.failed.heading")}
      </h1>
      <p className={cardStyles["copy"]}>
        {/* Sanitized at write time (first line, URLs redacted, capped). */}
        {error ?? t("pulls.failed.noDetail")}
      </p>
      <p className={cardStyles["meta"]}>
        {t("pulls.failed.attempts", { count: attempts + 1 })}{" "}
        {t("pulls.failed.requeueNote")}
      </p>
    </section>
  );
}
