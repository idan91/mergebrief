import { Callout } from "@web/components/Callout";
import { CalloutSurfaces } from "@web/components/Callout/types";
import { Chip } from "@web/components/Chip";
import { StackPanel, type StackPanelProps } from "./StackPanel";
import { useStackChipFacade } from "./useStackChipFacade";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./StackChip.module.scss";

export type StackChipProps = StackPanelProps;

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
