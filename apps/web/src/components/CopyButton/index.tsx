import { useTranslation } from "react-i18next";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Icon } from "../Icon";
import { type IconName, IconNames, IconSizes } from "../Icon/types";
import { IconButton } from "../IconButton";
import styles from "./CopyButton.module.scss";
import { COPY_FEEDBACK_RESET_MS } from "./consts";
import { CopyStates, type CopyState } from "./types";

export interface CopyButtonProps {
  /** The text written to the clipboard, or a resolver run at click time. */
  text: string | (() => string);
  /** Accessible action label, e.g. "Copy file path". */
  label: string;
  /** Tooltip; defaults to a literal text, else to the label. */
  title?: string | undefined;
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
 * failure feedback (icon + color + polite live-region announcement) that
 * resets after a moment. Feedback stays on the button itself so it works
 * inside any layout, including sticky headers, without a toast.
 */
export function CopyButton({
  text,
  label,
  title,
  icon = IconNames.COPY,
  content,
  onCopy,
  className,
}: CopyButtonProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<CopyState>(CopyStates.IDLE);
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = async () => {
    let next: CopyState = CopyStates.COPIED;
    const resolved = typeof text === "function" ? text() : text;
    try {
      await navigator.clipboard.writeText(resolved);
      onCopy?.(resolved);
    } catch {
      // Clipboard denied or insecure context, surfaced via the button's
      // own state, nothing else to recover.
      next = CopyStates.FAILED;
    }
    setState(next);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(
      () => setState(CopyStates.IDLE),
      COPY_FEEDBACK_RESET_MS,
    );
  };

  const announcementByState: Record<CopyState, string> = {
    [CopyStates.IDLE]: "",
    [CopyStates.COPIED]: t("shell.copied"),
    [CopyStates.FAILED]: t("shell.copyFailed"),
  };
  const announcement = announcementByState[state];
  const feedbackIconByState: Record<CopyState, IconName | undefined> = {
    [CopyStates.IDLE]: undefined,
    [CopyStates.COPIED]: IconNames.CHECK,
    [CopyStates.FAILED]: IconNames.X,
  };
  const feedbackIcon = feedbackIconByState[state];
  const resting = content ?? <Icon name={icon} size={IconSizes.SM} />;
  const glyph =
    feedbackIcon === undefined ? (
      resting
    ) : (
      <Icon name={feedbackIcon} size={IconSizes.SM} />
    );

  return (
    <IconButton
      autoWidth={content !== undefined}
      className={`${styles["copyButton"]}${className ? ` ${className}` : ""}`}
      data-state={state}
      label={label}
      title={title ?? (typeof text === "string" ? text : label)}
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
