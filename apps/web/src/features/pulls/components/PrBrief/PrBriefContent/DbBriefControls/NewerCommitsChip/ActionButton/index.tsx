import clsx from "clsx";

import { Button } from "@web/components/Button";
import { Icon } from "@web/components/Icon";
import { IconRotations, IconSizes } from "@web/components/Icon/types";
import { handOffFocusOnRemoval } from "../../../../../../utils/focus-hand-off";
import { ActionIcons } from "../consts";
import { NewerCommitsActionKinds, type NewerCommitsAction } from "../types";
import styles from "./ActionButton.module.scss";

export interface ActionButtonProps {
  action: NewerCommitsAction;
  /** Where it sits: butted against the chip, or at the foot of the popover. */
  className?: string | undefined;
}

/**
 * The chip's one action as the small secondary Button with a leading glyph;
 * navigation trails its arrow instead. A poll that drops it while it holds
 * focus hands focus to the main landmark.
 */
export function ActionButton({ action, className }: ActionButtonProps) {
  const navigates = action.kind === NewerCommitsActionKinds.NAVIGATE;
  const rotation = navigates ? IconRotations.QUARTER : IconRotations.NONE;
  const glyph = (
    <Icon
      name={ActionIcons[action.kind]}
      rotation={rotation}
      size={IconSizes.SM}
    />
  );
  const leadingGlyph = navigates ? null : glyph;
  const trailingGlyph = navigates ? glyph : null;

  return (
    <Button
      className={clsx(styles["action"], className)}
      loading={action.pending}
      ref={handOffFocusOnRemoval}
      size="sm"
      type="button"
      variant="secondary"
      onClick={action.onTrigger}
    >
      {leadingGlyph}
      {action.label}
      {trailingGlyph}
    </Button>
  );
}
