import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock";
import type { GenerationFailureCode, PrState } from "types";
import type { UnknownValue } from "@web/utils/open-enum/types";

import { TriggerAction } from "../TriggerAction";
import { useFailedCardFacade } from "./useFailedCardFacade";

export interface FailedCardProps {
  /** Absent when the wire sent none or one this bundle doesn't know. */
  errorCode: GenerationFailureCode | undefined;
  /** Sanitized detail for the two codes that carry one. */
  errorDetail: string | undefined;
  attempts: number;
  repoId: string;
  prNumber: number;
  /** Push alone, from PR meta. */
  viewerCanPush: boolean;
  /** The PR sits in an installation's world, which the route requires. */
  appInstalled: boolean;
  /** From PR meta; the route refuses a closed or merged PR. */
  prState: PrState | UnknownValue;
  /** A draft under a drafts-off instance: only ready for review queues a run. */
  awaitsReadyForReview: boolean;
}

export function FailedCard(props: FailedCardProps) {
  const { t } = useTranslation();
  const { detail, note, pending, announcement, onRegenerate } =
    useFailedCardFacade(props);

  return (
    <section aria-labelledby="failed-heading">
      <EmptyBlock
        action={
          <TriggerAction
            actionLabel={t("pulls.failed.regenerate.action")}
            announcement={announcement}
            pending={pending}
            pendingLabel={t("pulls.failed.regenerate.pending")}
            onTrigger={onRegenerate}
          />
        }
        detail={detail}
        heading={<h1 id="failed-heading">{t("pulls.failed.heading")}</h1>}
        note={note}
      />
    </section>
  );
}
