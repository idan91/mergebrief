import type { ReactNode } from "react";

import { Icon } from "../Icon";
import { type IconName, IconNames, IconSizes } from "../Icon/types";
import { IconButton } from "../IconButton";
import styles from "./CopyButton.module.scss";
import { CopyStates, type CopyState } from "./types";
import { useCopyFeedback } from "./useCopyFeedback";

export interface CopyButtonProps {
  /** The text written to the clipboard, or a resolver run at click time. */
  text: string | (() => string);
  /** The action's name and its callout, e.g. "Copy file path". */
  label: string;
  /** The resting glyph; the copied state always shows the check. */
  icon?: IconName | undefined;
  /** Visible content in place of the resting icon; the width follows it. */
  content?: ReactNode;
  /** Notified after a successful copy. */
  onCopy?: ((text: string) => void) | undefined;
  /** Extra class for layout at the call site (spacing, alignment). */
  className?: string | undefined;
}

/**
 * Icon button that copies `text` to the clipboard, with inline success/
 * failure feedback (icon, color, callout text and a polite live-region
 * announcement) that resets after a moment. The accessible name stays the
 * action; the outcome is announced, not renamed. Feedback stays on the button
 * itself so it works inside any layout, including sticky headers, without a
 * toast.
 */
export function CopyButton({
  text,
  label,
  icon = IconNames.COPY,
  content,
  onCopy,
  className,
}: CopyButtonProps) {
  const { state, copy, announcement } = useCopyFeedback({ text, onCopy });

  const feedbackIconByState: Record<CopyState, IconName | undefined> = {
    [CopyStates.IDLE]: undefined,
    [CopyStates.COPIED]: IconNames.CHECK,
    [CopyStates.FAILED]: IconNames.X,
  };
  const feedbackIcon = feedbackIconByState[state];
  const calloutLabel = state === CopyStates.IDLE ? label : announcement;
  const resting = content ?? <Icon name={icon} size={IconSizes.SM} />;
  const glyph =
    feedbackIcon === undefined ? (
      resting
    ) : (
      <Icon name={feedbackIcon} size={IconSizes.SM} />
    );

  return (
    <IconButton
      aria-label={label}
      autoWidth={content !== undefined}
      callout="top"
      className={`${styles["copyButton"]}${className ? ` ${className}` : ""}`}
      data-state={state}
      label={calloutLabel}
      onClick={() => void copy()}
    >
      {glyph}
      {/* Announce the outcome without moving focus. */}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </IconButton>
  );
}
