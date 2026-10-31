import { Callout } from "@web/components/Callout";
import { CalloutSurfaces } from "@web/components/Callout/types";
import { Chip } from "@web/components/Chip";
import type { PrStack } from "../../../../model/types";
import { StackPanel } from "./StackPanel";
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
  repoSlug: string;
  repoId?: string | undefined;
}

export function StackChip({
  stack,
  snapshot,
  asOf,
  atGeneration,
  currentNumber,
  repoSlug,
  repoId,
}: StackChipProps) {
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
        <Callout
          anchor={triggerEl}
          flush
          interactive
          onClose={close}
          surface={CalloutSurfaces.GROUND}
        >
          <span
            aria-label={panelAriaLabel}
            className={styles["panel"]}
            id={detailId}
            ref={landOnPanel}
            tabIndex={-1}
          >
            <StackPanel
              asOf={asOf}
              atGeneration={atGeneration}
              currentNumber={currentNumber}
              repoSlug={repoSlug}
              repoId={repoId}
              snapshot={snapshot}
              stack={stack}
            />
          </span>
        </Callout>
      ) : null}
    </span>
  );
}
