import { useId } from "react";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { Popover } from "@web/components/Popover";
import { HeldConditions } from "../../../../HeldConditions";
import { HeldConditionsLayouts } from "../../../../HeldConditions/types";
import { ActionButton } from "../ActionButton";
import type { NewerCommitsStatus } from "../types";
import styles from "./ExplainPopover.module.scss";

export interface ExplainPopoverProps {
  status: NewerCommitsStatus;
}

/**
 * The info button and the panel it opens: the state's full explanation and
 * the same action the chip offers. A disclosure: focus stays on the button,
 * Tab enters the panel, Escape closes it and returns focus to the button.
 */
export function ExplainPopover({ status }: ExplainPopoverProps) {
  const titleId = useId();
  const { action, runAction, failure, unmetConditions } = status;
  const unmetConditionsPartial = status.unmetConditionsPartial === true;
  const panelVariant = unmetConditions === undefined ? undefined : "held";

  return (
    <Popover placement="bottom-start" portal={false}>
      <Popover.Trigger>
        <IconButton className={styles["info"]} label={status.infoLabel}>
          <Icon name={IconNames.QUESTION} size={IconSizes.MD} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content className={styles["panel"]} variant={panelVariant}>
        <section aria-labelledby={titleId} data-testid="newer-commits-panel">
          <h2 className={styles["label"]}>
            <span aria-hidden="true" className={styles["dot"]} />
            {status.label}
          </h2>
          <p className={styles["title"]} id={titleId}>
            {status.title}
          </p>
          <div className={styles["body"]}>
            {status.explanation.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {failure === undefined ? null : (
              <p className={styles["failure"]}>{failure}</p>
            )}
          </div>
          {unmetConditions === undefined ? null : (
            <HeldConditions
              layout={HeldConditionsLayouts.POPOVER}
              unmetConditions={unmetConditions}
              unmetConditionsPartial={unmetConditionsPartial}
            />
          )}
          <div className={styles["actions"]}>
            {action === undefined ? null : <ActionButton action={action} />}
            {runAction === undefined ? null : (
              <ActionButton action={runAction} />
            )}
          </div>
        </section>
      </Popover.Content>
    </Popover>
  );
}
