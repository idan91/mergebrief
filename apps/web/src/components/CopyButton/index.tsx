import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";

import { Icon } from "../Icon";
import { type IconName, IconNames, IconSizes } from "../Icon/types";
import { IconButton } from "../IconButton";
import styles from "./CopyButton.module.scss";

type CopyState = "idle" | "copied" | "failed";

export interface CopyButtonProps {
  /** The text written to the clipboard, or a resolver run at click time. */
  text: string | (() => string);
  /** Accessible action label, e.g. "Copy file path". */
  label: string;
  /** Tooltip; defaults to a literal text, else to the label. */
  title?: string | undefined;
  /** The resting glyph; the copied state always shows the check. */
  icon?: IconName | undefined;
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
  onCopy,
  className,
}: CopyButtonProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = async () => {
    let next: CopyState = "copied";
    const resolved = typeof text === "function" ? text() : text;
    try {
      await navigator.clipboard.writeText(resolved);
      onCopy?.(resolved);
    } catch {
      // Clipboard denied or insecure context, surfaced via the button's
      // own state, nothing else to recover.
      next = "failed";
    }
    setState(next);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setState("idle"), 1600);
  };

  const announcementByState: Record<CopyState, string> = {
    idle: "",
    copied: t("shell.copied"),
    failed: t("shell.copyFailed"),
  };
  const announcement = announcementByState[state];

  return (
    <IconButton
      className={`${styles["copyButton"]}${className ? ` ${className}` : ""}`}
      data-state={state}
      label={label}
      title={title ?? (typeof text === "string" ? text : label)}
      onClick={() => void copy()}
    >
      <Icon
        name={state === "copied" ? IconNames.CHECK : icon}
        size={IconSizes.SM}
      />
      {/* Announce the outcome without moving focus. */}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </IconButton>
  );
}
