// The PR's current head is held by its trigger conditions and no brief is
// shown for it: the conditions grouped by what clears them, and Generate now.
// Presentational; the state announcement lives in the body's region.
import { useTranslation } from "react-i18next";
import type { PrState } from "types";
import type { UnmetCondition } from "types/trigger-conditions";

import type { UnknownValue } from "@web/utils/open-enum/types";
import { HeldConditions } from "../HeldConditions";
import { HeldConditionsLayouts } from "../HeldConditions/types";
import { TriggerAction } from "../TriggerAction";
import { useHeldCardFacade } from "./useHeldCardFacade";
import styles from "./HeldCard.module.scss";

const HEADING_ID = "held-heading";

export interface HeldCardProps {
  repoId: string;
  prNumber: number;
  unmetConditions: readonly UnmetCondition[];
  /** Push alone, from PR meta: the regenerate route's collaborator bar. */
  viewerCanPush: boolean;
  appInstalled: boolean;
  prState: PrState | UnknownValue;
}

export function HeldCard(props: HeldCardProps) {
  const { t } = useTranslation();
  const { lead, showsConditions, pending, announcement, onGenerate } =
    useHeldCardFacade(props);

  return (
    <section
      aria-labelledby={HEADING_ID}
      className={styles["panel"]}
      data-testid="brief-held-card"
    >
      <header className={styles["head"]}>
        <div className={styles["title"]}>
          <h1 className={styles["heading"]} id={HEADING_ID}>
            {t("pulls.held.heading")}
          </h1>
          <p className={styles["lead"]}>{lead}</p>
        </div>
        <TriggerAction
          actionLabel={t("pulls.held.generate.action")}
          announcement={announcement}
          pending={pending}
          pendingLabel={t("pulls.held.generate.pending")}
          onTrigger={onGenerate}
        />
      </header>
      {showsConditions ? (
        <HeldConditions
          layout={HeldConditionsLayouts.PANEL}
          unmet={props.unmetConditions}
        />
      ) : null}
    </section>
  );
}
