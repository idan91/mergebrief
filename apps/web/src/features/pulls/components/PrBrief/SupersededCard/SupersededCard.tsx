import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock/EmptyBlock";

export function SupersededCard() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="superseded-heading">
      <EmptyBlock
        busy
        detail={t("pulls.superseded.copy")}
        heading={
          <h1 id="superseded-heading">{t("pulls.superseded.heading")}</h1>
        }
      />
    </section>
  );
}
