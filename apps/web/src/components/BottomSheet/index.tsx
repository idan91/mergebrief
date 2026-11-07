import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { useBodyScrollLock } from "@web/hooks/useBodyScrollLock";
import { useFocusTrap } from "@web/hooks/useFocusTrap";
import { BottomSheetHeights, type BottomSheetHeight } from "./types";
import styles from "./BottomSheet.module.scss";

export interface BottomSheetProps {
  label: string;
  /** Names the scrim, which is a tap target with no text of its own. */
  closeLabel: string;
  close: () => void;
  id?: string;
  testId?: string;
  /** Where focus lands on open; the dialog itself when absent or unmatched. */
  initialFocusSelector?: string;
  children: ReactNode;
}

/**
 * A modal sheet rising from the bottom edge, opening at half height with a
 * handle to the full height. Mounted = open; the caller owns the open state.
 * A surface pinned above it sets --bottom-sheet-offset.
 */
export function BottomSheet({
  label,
  closeLabel,
  close,
  id,
  testId,
  initialFocusSelector,
  children,
}: BottomSheetProps) {
  const { t } = useTranslation();
  const [height, setHeight] = useState<BottomSheetHeight>(
    BottomSheetHeights.HALF,
  );
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onTrapKeyDown = useFocusTrap(dialogRef);
  useBodyScrollLock(true);

  useEffect(() => {
    const dialog = dialogRef.current ?? undefined;
    const target =
      initialFocusSelector === undefined
        ? undefined
        : (dialog?.querySelector<HTMLElement>(initialFocusSelector) ??
          undefined);
    (target ?? dialog)?.focus();
    // Focus lands once, on open.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    onTrapKeyDown(event);
  }

  const full = height === BottomSheetHeights.FULL;
  const toggleHeight = () =>
    setHeight(full ? BottomSheetHeights.HALF : BottomSheetHeights.FULL);
  const handleLabel = full
    ? t("shell.sheet.shrinkToHalf")
    : t("shell.sheet.expandToFull");

  return (
    <>
      {/* oxlint-disable-next-line house/no-raw-button -- full-viewport scrim: a tap target with no chrome */}
      <button
        aria-label={closeLabel}
        className={styles["scrim"]}
        type="button"
        onClick={close}
      />
      {/* The keydown is the dialog's Tab trap and Escape, not an interaction of its own. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        aria-label={label}
        aria-modal="true"
        className={styles["sheet"]}
        data-height={height}
        data-testid={testId}
        id={id}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {/* oxlint-disable-next-line house/no-raw-button -- the sheet's grab handle: a pill, not a labelled control */}
        <button
          aria-expanded={full}
          aria-label={handleLabel}
          className={styles["handle"]}
          type="button"
          onClick={toggleHeight}
        />
        {children}
      </div>
    </>
  );
}
