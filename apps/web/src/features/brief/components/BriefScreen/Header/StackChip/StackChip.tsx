import { useTranslation } from "react-i18next";

import { Callout } from "@web/components/Callout/Callout";
import { Chip } from "@web/components/Chip/Chip";
import type { PrStack } from "../../../../types";
import { StackLists } from "./StackLists/StackLists";
import { useStackChipFacade } from "./useStackChipFacade";
import { Icon } from "@web/components/Icon/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./StackChip.module.scss";

export interface StackChipProps {
  stack: PrStack;
  /** The generation-time stack, when it differs from `stack`. */
  snapshot?: PrStack | undefined;
  currentNumber: number;
  prUrl: string;
  repoId?: string | undefined;
}

export function StackChip({
  stack,
  snapshot,
  currentNumber,
  prUrl,
  repoId,
}: StackChipProps) {
  const { t } = useTranslation();
  const {
    chipLabel,
    close,
    controlsId,
    detailId,
    handlePointerEnter,
    handleTriggerClick,
    landOnPanel,
    open,
    panelAriaLabel,
    setTriggerEl,
    triggerEl,
    visibleLabel,
  } = useStackChipFacade({ stack });

  return (
    <span
      className={styles["hoverArea"]}
      onPointerEnter={(event) => handlePointerEnter(event.pointerType)}
    >
      <Chip
        aria-controls={controlsId}
        aria-expanded={open}
        aria-label={chipLabel}
        data-testid="stack-chip"
        ref={setTriggerEl}
        onClick={handleTriggerClick}
      >
        <Icon
          className={styles["mark"]}
          name={IconNames.STACK}
          size={IconSizes.SM}
        />
        {visibleLabel}
      </Chip>
      {open && triggerEl ? (
        <Callout anchor={triggerEl} compact fit interactive onClose={close}>
          <span
            aria-label={panelAriaLabel}
            className={styles["panel"]}
            id={detailId}
            ref={landOnPanel}
            tabIndex={-1}
          >
            <StackLists
              currentNumber={currentNumber}
              listLabel={t("brief.header.stackDisclosureAria")}
              prUrl={prUrl}
              repoId={repoId}
              stack={stack}
            />
            {snapshot !== undefined ? (
              <span className={styles["snapshot"]}>
                <span className={styles["changed"]}>
                  {t("brief.header.stackChanged")}
                </span>
                <span className={styles["leadIn"]}>
                  {t("brief.header.stackAtGeneration")}
                </span>
                <StackLists
                  currentNumber={currentNumber}
                  listLabel={t("brief.header.stackAtGenerationAria")}
                  prUrl={prUrl}
                  repoId={repoId}
                  stack={snapshot}
                />
              </span>
            ) : null}
          </span>
        </Callout>
      ) : null}
    </span>
  );
}
