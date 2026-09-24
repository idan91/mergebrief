// This push got no brief because the repo hit the instance's daily
// generation cap. Not a failure: nothing went wrong, and the copy says when
// it resumes. Presentational; the announcement lives in the body's live
// region.
import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock/EmptyBlock";
import { cappedLabel } from "./utils";

export interface CappedCardProps {
  /** When the skip was recorded (the projection row's `updatedAt`). */
  cappedAt: string;
}

export function CappedCard({ cappedAt }: CappedCardProps) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="capped-heading" data-testid="brief-capped-card">
      <EmptyBlock
        detail={t("pulls.capped.copy")}
        heading={<h1 id="capped-heading">{cappedLabel(t, cappedAt)}</h1>}
      />
    </section>
  );
}
