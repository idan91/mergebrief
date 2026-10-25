// This push got no brief because the instance hit its daily generation
// cap. Not a failure: nothing went wrong, and the copy says when it resumes.
// Presentational; the announcement lives in the body's live region.
import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock";
import type { PrSummary } from "../../../types";
import { buildCappedCardDetail, buildCappedLabel } from "../capped-head";

export interface CappedCardProps {
  /** When the skip was recorded (the projection row's `updatedAt`). */
  cappedAt: string;
  prState: PrSummary["state"];
  appInstalled: boolean;
  /** A draft under a drafts-off instance: only ready for review queues a run. */
  awaitsReadyForReview: boolean;
}

export function CappedCard({
  cappedAt,
  prState,
  appInstalled,
  awaitsReadyForReview,
}: CappedCardProps) {
  const { t } = useTranslation();
  const detail = buildCappedCardDetail(t, {
    prState,
    appInstalled,
    awaitsReadyForReview,
  });
  return (
    <section aria-labelledby="capped-heading" data-testid="brief-capped-card">
      <EmptyBlock
        detail={detail}
        heading={<h1 id="capped-heading">{buildCappedLabel(t, cappedAt)}</h1>}
      />
    </section>
  );
}
