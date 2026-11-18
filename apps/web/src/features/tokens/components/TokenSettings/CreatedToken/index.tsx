import { useEffect, useId, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { CopyStates, type CopyState } from "@web/components/CopyButton/types";
import { useCopyFeedback } from "@web/components/CopyButton/useCopyFeedback";
import styles from "./CreatedToken.module.scss";

// An identifier, never copy: a translated shell command would be a broken instruction.
const CHMOD_COMMAND = "chmod 600";

export interface CreatedTokenProps {
  /** The secret, shown once; it stays on screen until the viewer is done with it. */
  token: string;
  dismiss: () => void;
}

/** The shown-once token. Focus lands on Copy, the one action that cannot be repeated later. */
export function CreatedToken({ token, dismiss }: CreatedTokenProps) {
  const { t } = useTranslation();
  const { state: copyState, copy } = useCopyFeedback({ text: token });
  const copyRef = useRef<HTMLButtonElement | null>(null);
  const headingId = useId();

  useEffect(() => {
    copyRef.current?.focus();
  }, []);

  const copyLabelByState: Record<CopyState, string> = {
    [CopyStates.IDLE]: t("tokens.copyToken"),
    [CopyStates.COPIED]: t("tokens.tokenCopied"),
    [CopyStates.FAILED]: t("shell.copyFailed"),
  };

  const copyAnnouncement =
    copyState === CopyStates.IDLE ? "" : copyLabelByState[copyState];

  return (
    <div aria-labelledby={headingId} className={styles["created"]} role="group">
      <p className={styles["heading"]} id={headingId}>
        {t("tokens.createdHeading")}
      </p>
      <div className={styles["secret"]}>
        <code className={styles["value"]}>{token}</code>
        <Button ref={copyRef} variant="primary" onClick={() => void copy()}>
          {copyLabelByState[copyState]}
        </Button>
      </div>
      <p className={styles["disclaimer"]}>
        <Trans
          components={[<code key="chmod">{CHMOD_COMMAND}</code>]}
          i18nKey="tokens.disclaimer"
        />
      </p>
      <Button className={styles["done"]} onClick={dismiss}>
        {t("tokens.done")}
      </Button>
      {/* The only live region here: the secret must never sit inside one. */}
      <span className="sr-only" role="status">
        {copyAnnouncement}
      </span>
    </div>
  );
}
