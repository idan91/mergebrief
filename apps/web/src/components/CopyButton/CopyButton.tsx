import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";

import { Icon } from "../Icon/Icon";
import { IconNames, IconSizes } from "../Icon/types";
import { IconButton } from "../IconButton/IconButton";
import styles from "./CopyButton.module.scss";

type CopyState = "idle" | "copied" | "failed";

export interface CopyButtonProps {
  /** The text written to the clipboard. */
  text: string;
  /** Accessible action label, e.g. "Copy file path". */
  label: string;
  /** Tooltip; defaults to the text being copied. */
  title?: string | undefined;
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
  onCopy,
  className,
}: CopyButtonProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = async () => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(text);
      onCopy?.(text);
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
      title={title ?? text}
      onClick={() => void copy()}
    >
      <Icon
        name={state === "copied" ? IconNames.CHECK : IconNames.COPY}
        size={IconSizes.SM}
      />
      {/* Announce the outcome without moving focus. */}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </IconButton>
  );
}
