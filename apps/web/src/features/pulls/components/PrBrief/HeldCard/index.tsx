// The PR's current head is held by its trigger conditions and no brief is
// shown for it: the conditions grouped by what clears them, and Generate
// brief with a menu row that generates every push of the PR.
// Presentational; the state announcement and the every-push outcome live in
// the body's regions, since a saved switch releases the head and removes
// this card.
import { useTranslation } from "react-i18next";
import type { PrState } from "types";

import type { UnknownValue } from "@web/utils/open-enum/types";
import { HeldConditions } from "../HeldConditions";
import type { HeldCondition } from "@web/utils/unmet-conditions/types";
import { HeldConditionsLayouts } from "../HeldConditions/types";
import { Menu } from "@web/components/Menu";
import { TriggerAction, type TriggerMoreRuns } from "../TriggerAction";
import { useHeldCardFacade } from "./useHeldCardFacade";
import styles from "./HeldCard.module.scss";

const HEADING_ID = "held-heading";

export interface HeldCardProps {
  repoId: string;
  prNumber: number;
  unmetConditions: readonly HeldCondition[];
  /** The list left out an item the server or this bundle could not read. */
  unmetConditionsPartial: boolean;
  /** The page's live region, which outlives this card. */
  onAnnounce: (message: string) => void;
  /** Push alone, from PR meta: the regenerate route's collaborator bar. */
  viewerCanPush: boolean;
  appInstalled: boolean;
  prState: PrState | UnknownValue;
  /** Every push of this PR generates, conditions or not; from PR meta. */
  generateEveryPush: boolean;
}

export function HeldCard(props: HeldCardProps) {
  const { t } = useTranslation();
  const {
    heading,
    lead,
    showsConditions,
    pending,
    announcement,
    onGenerate,
    everyPush,
  } = useHeldCardFacade(props);
  const moreRuns: TriggerMoreRuns | undefined =
    everyPush === undefined
      ? undefined
      : {
          label: t("pulls.held.generate.more"),
          rows: (
            <Menu.Item
              description={t("pulls.everyPush.hint")}
              onSelect={everyPush.turnOn}
            >
              {t("pulls.everyPush.label")}
            </Menu.Item>
          ),
          outcome: everyPush.outcome,
        };

  return (
    <section
      aria-labelledby={HEADING_ID}
      className={styles["panel"]}
      data-testid="brief-held-card"
    >
      <header className={styles["head"]}>
        <div className={styles["title"]}>
          <h1 className={styles["heading"]} id={HEADING_ID}>
            {heading}
          </h1>
          <p className={styles["lead"]}>{lead}</p>
        </div>
        <TriggerAction
          actionLabel={t("pulls.held.generate.action")}
          announcement={announcement}
          moreRuns={moreRuns}
          pending={pending}
          pendingLabel={t("pulls.held.generate.pending")}
          onTrigger={onGenerate}
        />
      </header>
      {showsConditions ? (
        <HeldConditions
          layout={HeldConditionsLayouts.PANEL}
          unmetConditions={props.unmetConditions}
          unmetConditionsPartial={props.unmetConditionsPartial}
        />
      ) : null}
    </section>
  );
}
