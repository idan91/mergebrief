import { Callout } from "@web/components/Callout/Callout";
import { Chip } from "@web/components/Chip/Chip";
import type { PrStack } from "../../../../types";
import { ForkLists } from "./ForkLists/ForkLists";
import { NeighbourList } from "./NeighbourList/NeighbourList";
import { useStackChipFacade } from "./useStackChipFacade";
import { isLinearPrStack } from "./utils";
import styles from "./StackChip.module.scss";

export interface StackChipProps {
  stack: PrStack;
  currentNumber: number;
  prUrl: string;
  repoId?: string | undefined;
}

export function StackChip({
  stack,
  currentNumber,
  prUrl,
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
        {visibleLabel}
      </Chip>
      {open && triggerEl ? (
        <Callout anchor={triggerEl} fit interactive onClose={close}>
          <span
            aria-label={panelAriaLabel}
            className={styles["panel"]}
            id={detailId}
            ref={landOnPanel}
            tabIndex={-1}
          >
            {isLinearPrStack(stack) ? (
              <NeighbourList
                currentNumber={currentNumber}
                labelled
                members={stack.members}
                prUrl={prUrl}
                repoId={repoId}
              />
            ) : (
              <ForkLists
                currentNumber={currentNumber}
                prUrl={prUrl}
                repoId={repoId}
                stack={stack}
              />
            )}
          </span>
        </Callout>
      ) : null}
    </span>
  );
}
