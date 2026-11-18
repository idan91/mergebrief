import clsx from "clsx";
import { useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { InboxReviewState } from "types/inbox";

import { Callout } from "@web/components/Callout";
import { useCalloutHover } from "@web/components/Callout/useCalloutHover";
import { Checkbox } from "@web/components/Checkbox";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import type { UnknownValue } from "@web/utils/open-enum/types";
import styles from "./RowLead.module.scss";
import { readReviewStateTip } from "./utils";

export interface RowLeadProps {
  /** The row places the slot and decides when the checkbox shows. */
  className: string | undefined;
  /** Absent for the viewer's own pull request. */
  reviewState: InboxReviewState | UnknownValue | undefined;
  /** The row's title, which names its checkbox. */
  title: string;
  selected: boolean;
  /** `range` is a shift-click. */
  onSelect: (checked: boolean, range: boolean) => void;
}

/**
 * The row's lead slot: the selection checkbox, drawn over the review mark
 * when the row shows it. A pointer resting on the slot, or keyboard focus
 * on the box, names the review state in a callout the box is not described
 * by, since the row link already says it to assistive technology.
 */
export function RowLead({
  className,
  reviewState,
  title,
  selected,
  onSelect,
}: RowLeadProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const hover = useCalloutHover();
  // The change event carries no modifier; the click before it does.
  const shiftRef = useRef(false);
  const tip = readReviewStateTip(t, reviewState);
  const showsTip = hover.open && anchor !== null && tip !== undefined;

  function handleFocus(event: FocusEvent): void {
    if (tip !== undefined && event.target.matches(":focus-visible")) {
      hover.show();
    }
  }
  function handlePointerEnter(event: PointerEvent): void {
    if (tip !== undefined) {
      hover.arm(event);
    }
  }
  function handleChange(checked: boolean): void {
    onSelect(checked, shiftRef.current);
  }

  return (
    <>
      <span
        className={clsx(className, styles["slot"])}
        data-testid="inbox-row-lead"
        ref={setAnchor}
        onBlur={hover.close}
        onClickCapture={(event) => {
          shiftRef.current = event.shiftKey;
        }}
        onFocus={handleFocus}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={hover.disarm}
      >
        <Checkbox checked={selected} onChange={handleChange}>
          <ScreenReaderOnly>
            {t("home.inbox.select.row", { title })}
          </ScreenReaderOnly>
        </Checkbox>
      </span>
      {showsTip ? (
        <Callout anchor={anchor} compact fit onClose={hover.close}>
          <Callout.Title>{tip}</Callout.Title>
        </Callout>
      ) : null}
    </>
  );
}
