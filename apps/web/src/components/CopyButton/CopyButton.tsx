import { useEffect, useRef, useState } from "react";

import { ScreenReaderOnly } from "../ScreenReaderOnly";
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
 * inside any layout — including sticky headers — without a toast.
 */
export function CopyButton({
  text,
  label,
  title,
  onCopy,
  className,
}: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = async () => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(text);
      onCopy?.(text);
    } catch {
      // Clipboard denied or insecure context — surfaced via the button's
      // own state, nothing else to recover.
      next = "failed";
    }
    setState(next);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setState("idle"), 1600);
  };

  return (
    <button
      className={`${styles["copyButton"]}${className ? ` ${className}` : ""}`}
      data-state={state}
      title={title ?? text}
      type="button"
      onClick={() => void copy()}
    >
      <svg
        aria-hidden="true"
        fill="none"
        height="12"
        stroke="currentColor"
        strokeWidth="1.4"
        viewBox="0 0 14 14"
        width="12"
      >
        {state === "copied" ? (
          <path d="M2.5 7.5 6 11l5.5-8" />
        ) : (
          <>
            <rect height="8" rx="1.5" width="8" x="4.5" y="4.5" />
            <path d="M9.5 2.5h-6a1.5 1.5 0 0 0-1.5 1.5v6" />
          </>
        )}
      </svg>
      <ScreenReaderOnly>{label}</ScreenReaderOnly>
      {/* Announce the outcome without moving focus. */}
      <span aria-live="polite" className="sr-only">
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed"
            : ""}
      </span>
    </button>
  );
}
