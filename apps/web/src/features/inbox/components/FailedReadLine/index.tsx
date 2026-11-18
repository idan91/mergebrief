import { useState } from "react";
import { useTranslation } from "react-i18next";

import { LinkButton } from "@web/components/LinkButton";
import type { ApiErrorCode } from "../../../../data/apiFetch";
import { FailureSides } from "../../types";
import { readFailureSide } from "../../utils";
import { focusMainContent } from "../utils";
import styles from "./FailedReadLine.module.scss";

export interface FailedReadLineProps {
  /** Why the last read of the list on screen failed; absent while it is current. */
  code: ApiErrorCode | undefined;
  /** Read again; resolves true once the list arrived. */
  onRetry: () => Promise<boolean>;
}

/**
 * One quiet line while the list on screen failed its last read: the rows
 * stay, the line says they may be behind, and Try again asks once more.
 * The live region stays mounted so the line is spoken when it appears; a
 * retry that fails again re-keys the words so they are spoken anew, and
 * one that succeeds hands focus to main, since the button is gone.
 */
export function FailedReadLine({ code, onRetry }: FailedReadLineProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [failedRetries, setFailedRetries] = useState(0);

  let detail = "";
  if (code !== undefined) {
    detail =
      readFailureSide(code) === FailureSides.GITHUB
        ? t("home.failedRead.github")
        : t("home.failedRead.server");
  }

  async function retry(): Promise<void> {
    setPending(true);
    let arrived = false;
    try {
      arrived = await onRetry();
    } catch {
      arrived = false;
    } finally {
      setPending(false);
    }
    if (arrived) {
      focusMainContent();
      return;
    }
    setFailedRetries((count) => count + 1);
  }

  return (
    <>
      {code === undefined ? null : (
        <p className={styles["line"]} data-testid="failed-read">
          <span aria-hidden="true">{detail}</span>{" "}
          <LinkButton
            aria-busy={pending}
            disabled={pending}
            onClick={() => {
              void retry();
            }}
          >
            {t("home.failed.retry")}
          </LinkButton>
        </p>
      )}
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {code === undefined ? null : <span key={failedRetries}>{detail}</span>}
      </p>
    </>
  );
}
