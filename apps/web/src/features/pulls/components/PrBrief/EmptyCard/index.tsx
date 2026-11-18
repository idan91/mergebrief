import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock";

export interface EmptyCardProps {
  /** Replaces the default copy where its next-push promise is false (`buildEmptyCopyOverride`). */
  copyOverride?: string | undefined;
}

export function EmptyCard({ copyOverride }: EmptyCardProps) {
  const { t } = useTranslation();
  const detail = copyOverride ?? t("pulls.empty.copy");

  return (
    <section aria-labelledby="empty-heading">
      <EmptyBlock
        detail={detail}
        ghostMark
        heading={<h1 id="empty-heading">{t("pulls.empty.heading")}</h1>}
      />
    </section>
  );
}
