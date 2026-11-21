// This push got no brief because the instance hit its daily generation
// cap. Not a failure: nothing went wrong, and the copy says when it resumes.
// Presentational; the announcement lives in the body's live region.
import { useTranslation } from "react-i18next";
import type { GenerationUnitsParams } from "types/generations";
import { EmptyBlock } from "@web/components/EmptyBlock";
import type { PrSummary } from "../../../types";
import { buildCappedCardDetail, buildCappedLabel } from "../capped-head";

export interface CappedCardProps {
  /** When the skip was recorded (the projection row's `updatedAt`). */
  cappedAt: string;
  prState: PrSummary["state"];
  appInstalled: boolean;
  /** A large run the cap refused: the runs it needed and the day's rest. */
  units?: GenerationUnitsParams | undefined;
}

export function CappedCard({
  cappedAt,
  prState,
  appInstalled,
  units,
}: CappedCardProps) {
  const { t } = useTranslation();
  const detail = buildCappedCardDetail(t, {
    prState,
    appInstalled,
    units,
  });
  const heading = buildCappedLabel(t, { cappedAt, units });
  return (
    <section aria-labelledby="capped-heading" data-testid="brief-capped-card">
      <EmptyBlock
        detail={detail}
        heading={<h1 id="capped-heading">{heading}</h1>}
      />
    </section>
  );
}
