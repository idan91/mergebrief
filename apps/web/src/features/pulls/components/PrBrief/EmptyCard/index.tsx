import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock";

export interface EmptyCardProps {
  /** Drafts-off notice (own-draft only); replaces the copy. */
  copyOverride?: string | undefined;
}

export function EmptyCard({ copyOverride }: EmptyCardProps) {
  const { t } = useTranslation();
  // The drafts-off notice replaces the default copy wholesale: the default
  // promises generation "on the next push", wrong under that policy.
  const detail = copyOverride ?? t("pulls.empty.copy");

  return (
    <section aria-labelledby="empty-heading">
      <EmptyBlock
        detail={detail}
        heading={<h1 id="empty-heading">{t("pulls.empty.heading")}</h1>}
      />
    </section>
  );
}
