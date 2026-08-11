// This push got no brief because the repo hit the instance's daily
// generation cap. NOT a failure card — nothing went wrong, and the copy says
// when it resumes. Presentational; the announcement lives in the body's live
// region.
import { useTranslation } from "react-i18next";
import cardStyles from "../stateCard.module.scss";
import { cappedLabel } from "./utils";

export interface CappedCardProps {
  /** When the skip was recorded (the projection row's `updatedAt`). */
  cappedAt: string;
}

export function CappedCard({ cappedAt }: CappedCardProps) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="capped-heading"
      className={cardStyles["card"]}
      data-testid="brief-capped-card"
    >
      <h1 className={cardStyles["heading"]} id="capped-heading">
        {cappedLabel(t, cappedAt)}
      </h1>
      <p className={cardStyles["copy"]}>{t("pulls.capped.copy")}</p>
    </section>
  );
}
