// The PR's runs wait for a collaborator's Trigger approval: nothing ran and
// nothing failed. A pusher's Generate click approves the PR and queues its
// brief. Presentational; the state announcement lives in the body's region.
import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock";
import type { UnknownValue } from "@web/utils/open-enum/types";
import type { PrState } from "types";

import { TriggerAction } from "../TriggerAction";
import { useAwaitingTriggerCardFacade } from "./useAwaitingTriggerCardFacade";

export interface AwaitingTriggerCardProps {
  repoId: string;
  prNumber: number;
  /** Push alone, from PR meta: the route's collaborator bar. */
  viewerCanPush: boolean;
  /** The PR sits in an installation's world, which the route requires. */
  appInstalled: boolean;
  /** From PR meta; the route refuses a closed or merged PR. */
  prState: PrState | UnknownValue;
  /** A draft under a drafts-off instance: only ready for review queues a run. */
  awaitsReadyForReview: boolean;
}

export function AwaitingTriggerCard(props: AwaitingTriggerCardProps) {
  const { t } = useTranslation();
  const { heading, detail, pending, announcement, onGenerate } =
    useAwaitingTriggerCardFacade(props);

  return (
    <section
      aria-labelledby="awaiting-trigger-heading"
      data-testid="brief-awaiting-trigger-card"
    >
      <EmptyBlock
        action={
          <TriggerAction
            actionLabel={t("pulls.awaitingTrigger.generate.action")}
            announcement={announcement}
            pending={pending}
            pendingLabel={t("pulls.awaitingTrigger.generate.pending")}
            onTrigger={onGenerate}
          />
        }
        detail={detail}
        ghostMark
        heading={<h1 id="awaiting-trigger-heading">{heading}</h1>}
      />
    </section>
  );
}
