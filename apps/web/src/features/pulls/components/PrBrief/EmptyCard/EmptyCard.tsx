import { useTranslation } from "react-i18next";
import cardStyles from "../stateCard.module.scss";

export interface EmptyCardProps {
  /** Drafts-off notice (own-draft only); replaces the copy. */
  copyOverride?: string | undefined;
}

export function EmptyCard({ copyOverride }: EmptyCardProps) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="empty-heading" className={cardStyles["card"]}>
      <h1 className={cardStyles["heading"]} id="empty-heading">
        {t("pulls.empty.heading")}
      </h1>
      {/* The drafts-off notice replaces the default copy wholesale — the
          default promises generation "on the next push", wrong under that
          policy. */}
      <p className={cardStyles["copy"]}>
        {copyOverride ?? t("pulls.empty.copy")}
      </p>
    </section>
  );
}
