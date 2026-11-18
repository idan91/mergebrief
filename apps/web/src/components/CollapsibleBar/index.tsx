import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import clsx from "clsx";

import { Icon } from "../Icon";
import { IconNames, IconRotations, IconSizes } from "../Icon/types";
import type { BarHeadingLevel } from "./types";
import styles from "./CollapsibleBar.module.scss";

export interface CollapsibleBarProps extends Omit<
  ComponentPropsWithoutRef<"section">,
  "title" | "children"
> {
  /** The level the page outline gives this bar; the bar styles every level alike. */
  headingLevel: BarHeadingLevel;
  title: ReactNode;
  /** Quiet text after the title, shown open or closed. */
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Controls beside the head, outside the toggle. */
  actions?: ReactNode;
  /** A line under the head, shown open or closed. */
  note?: ReactNode;
  /** The toggle's id, for a caller that moves focus to it. */
  toggleId?: string | undefined;
  /** For a caller that scrolls to the toggle and owns its scroll margin. */
  toggleClassName?: string | undefined;
  /** The panel, rendered hidden while closed. */
  children: ReactNode;
}

/**
 * One fold row of a `BarGroup`: a full-width head whose heading is the
 * disclosure (caret, title, summary), over a panel that opens in place. The
 * group draws the surface and the hairlines between rows.
 */
export function CollapsibleBar({
  headingLevel: Heading,
  title,
  summary,
  open,
  onToggle,
  actions,
  note,
  toggleId,
  toggleClassName,
  children,
  className,
  ...rest
}: CollapsibleBarProps) {
  const titleId = useId();
  const panelId = useId();
  const barClassName = clsx(styles["bar"], className);
  const barOpen = open || undefined;
  const headToggleClassName = clsx(styles["toggle"], toggleClassName);
  const caretRotation = open
    ? IconRotations.NONE
    : IconRotations.THREE_QUARTERS;

  return (
    <section
      {...rest}
      aria-labelledby={titleId}
      className={barClassName}
      data-bar-open={barOpen}
    >
      <div className={styles["head"]}>
        <Heading className={styles["heading"]}>
          {/* oxlint-disable-next-line house/no-raw-button -- the bar head is a full-width heading disclosure no shared button draws */}
          <button
            aria-controls={panelId}
            aria-expanded={open}
            className={headToggleClassName}
            id={toggleId}
            type="button"
            onClick={onToggle}
          >
            <Icon
              className={styles["caret"]}
              name={IconNames.CARET_DOWN}
              rotation={caretRotation}
              size={IconSizes.SM}
            />
            <span className={styles["title"]} id={titleId}>
              {title}
            </span>
            {summary !== undefined ? (
              <span className={styles["summary"]}>{summary}</span>
            ) : null}
          </button>
        </Heading>
        {actions !== undefined ? (
          <div className={styles["actions"]}>{actions}</div>
        ) : null}
      </div>
      {note !== undefined ? <div className={styles["note"]}>{note}</div> : null}
      <div
        className={styles["panel"]}
        data-bar-panel=""
        hidden={!open}
        id={panelId}
      >
        {children}
      </div>
    </section>
  );
}
