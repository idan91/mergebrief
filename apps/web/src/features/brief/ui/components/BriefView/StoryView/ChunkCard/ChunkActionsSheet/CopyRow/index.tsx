import clsx from "clsx";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { CopyStates } from "@web/components/CopyButton/types";
import { useCopyFeedback } from "@web/components/CopyButton/useCopyFeedback";
import styles from "./CopyRow.module.scss";

export interface CopyRowProps {
  label: string;
  /** The text written to the clipboard, or a resolver run at click time. */
  text: string | (() => string);
  onCopy?: ((text: string) => void) | undefined;
  /** The sheet's row chrome; the row only adds its feedback on top. */
  className?: string | undefined;
}

/** A sheet row that copies on tap and shows the outcome where the tap landed. */
export function CopyRow({ label, text, onCopy, className }: CopyRowProps) {
  const { state, copy, announcement } = useCopyFeedback({ text, onCopy });
  const copied = state === CopyStates.COPIED;

  return (
    // oxlint-disable-next-line house/no-raw-button -- a full-width sheet row with trailing feedback, which the shared buttons do not model
    <button
      className={clsx(className, styles["copyRow"])}
      data-state={state}
      type="button"
      onClick={() => void copy()}
    >
      {label}
      {copied ? (
        <Icon name={IconNames.CHECK} size={IconSizes.MD} />
      ) : (
        <Icon name={IconNames.COPY} size={IconSizes.MD} />
      )}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </button>
  );
}
