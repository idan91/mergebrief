import { useTranslation } from "react-i18next";
import cardStyles from "../stateCard.module.scss";

export function SupersededCard() {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="superseded-heading"
      className={cardStyles["card"]}
    >
      <h1 className={cardStyles["heading"]} id="superseded-heading">
        {t("pulls.superseded.heading")}
      </h1>
      <span aria-hidden="true" className={cardStyles["spinner"]} />
      <p className={cardStyles["copy"]}>{t("pulls.superseded.copy")}</p>
    </section>
  );
}
