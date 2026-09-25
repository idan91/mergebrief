import { useTranslation } from "react-i18next";

import { Callout } from "@web/components/Callout";
import { Chip } from "@web/components/Chip";
import { formatDate, renderedLocale } from "@web/i18n/locale";
import type { PrStack } from "../../../../types";
import { StackLists } from "./StackLists";
import { useStackChipFacade } from "./useStackChipFacade";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./StackChip.module.scss";

export interface StackChipProps {
  stack: PrStack;
  /** The generation-time stack, when it differs from `stack`. */
  snapshot?: PrStack | undefined;
  /** ISO time `stack` was recorded, when it is the record rather than live. */
  asOf?: string | undefined;
  /** `stack` is the generation-time one, standing in for a closed PR. */
  atGeneration?: boolean | undefined;
  currentNumber: number;
  prUrl: string;
  repoId?: string | undefined;
}

export function StackChip({
  stack,
  snapshot,
  asOf,
  atGeneration,
  currentNumber,
  prUrl,
  repoId,
}: StackChipProps) {
  const { i18n, t } = useTranslation();
  const listLabel = atGeneration
    ? t("brief.header.stackAtGenerationAria")
    : t("brief.header.stackDisclosureAria");
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
            {atGeneration ? (
              <span className={styles["leadIn"]}>
                {t("brief.header.stackAtGeneration")}
              </span>
            ) : null}
            <StackLists
              currentNumber={currentNumber}
              listLabel={listLabel}
              prUrl={prUrl}
              repoId={repoId}
              stack={stack}
            />
            {asOf !== undefined ? (
              <span className={styles["leadIn"]}>
                {t("brief.header.stackAsOf", {
                  date: formatDate(
                    asOf,
                    renderedLocale(i18n.resolvedLanguage),
                    { dateStyle: "medium" },
                  ),
                })}
              </span>
            ) : null}
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
