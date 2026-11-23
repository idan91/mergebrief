import type { Placement } from "@floating-ui/react";
import { useState, type ReactNode, type RefObject } from "react";

import { Button } from "@web/components/Button";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { Menu } from "@web/components/Menu";
import { handOffFocusOnRemoval } from "../../../../utils/focus-hand-off";
import styles from "./MoreRuns.module.scss";
import { deriveMenuPlacement } from "./utils";

export interface MoreRunsProps {
  /** The caret's accessible name. */
  label: string;
  /** `Menu.Item` rows, each another way to queue the run. */
  rows: ReactNode;
  disabled: boolean;
  /** The whole split button, whose edge the menu opens flush with. */
  anchor: RefObject<HTMLElement | null>;
}

/** The caret half of a split run button and the menu it opens. */
export function MoreRuns({ label, rows, disabled, anchor }: MoreRunsProps) {
  const [placement, setPlacement] = useState<Placement>("bottom-end");

  function placeOnOpen(): void {
    const box = anchor.current?.getBoundingClientRect();
    if (box !== undefined) {
      setPlacement(deriveMenuPlacement(box, window.innerWidth));
    }
  }

  return (
    <Menu anchor={anchor} placement={placement} onOpen={placeOnOpen}>
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
