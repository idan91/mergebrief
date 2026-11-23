import type { ReactNode } from "react";

import { Button } from "@web/components/Button";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { Menu } from "@web/components/Menu";
import { handOffFocusOnRemoval } from "../../../../utils/focus-hand-off";
import styles from "./MoreRuns.module.scss";

export interface MoreRunsProps {
  /** The caret's accessible name. */
  label: string;
  /** `Menu.Item` rows, each another way to queue the run. */
  rows: ReactNode;
  disabled: boolean;
}

/** The caret half of a split run button and the menu it opens. */
export function MoreRuns({ label, rows, disabled }: MoreRunsProps) {
  return (
    <Menu placement="bottom-end">
      <Menu.Trigger>
        <Button
          ref={handOffFocusOnRemoval}
          aria-label={label}
          className={styles["caret"]}
          disabled={disabled}
          type="button"
          variant="primary"
        >
          <Icon name={IconNames.CARET_DOWN} size={IconSizes.MD} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>{rows}</Menu.Content>
    </Menu>
  );
}
