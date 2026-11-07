import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import styles from "./TokenRow.module.scss";

export interface TokenRowProps {
  name: string;
  /** The scope label and the dates, already formatted. */
  meta: string;
  revoked: boolean;
  /** This page confirmed the revoke and the server accepted it. */
  revokedHere: boolean;
  revoking: boolean;
  /** Any row's revoke is waiting on the server; the page sends one at a time. */
  revokeInFlight: boolean;
  revoke: () => void;
}

/** One token. Revoke asks in the row: anything using the token stops working, with no undo. */
export function TokenRow({
  name,
  meta,
  revoked,
  revokedHere,
  revoking,
  revokeInFlight,
  revoke,
}: TokenRowProps) {
  const { t } = useTranslation();
  const warningId = useId();
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const revokeRef = useRef<HTMLButtonElement | null>(null);
  const wasConfirming = useRef(false);
  const rowRef = useRef<HTMLLIElement | null>(null);
  const landedHere = revoked && revokedHere;
  const revokedWhileConfirming = revoked && confirming;
  const focusFallsToRow = landedHere || revokedWhileConfirming;

  useEffect(() => {
    if (confirming) {
      keepRef.current?.focus();
    } else if (wasConfirming.current) {
      revokeRef.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  // The Revoke button or the confirm unmounts with the flip, which drops focus to the body.
  useEffect(() => {
    if (focusFallsToRow && document.activeElement === document.body) {
      rowRef.current?.focus();
    }
  }, [focusFallsToRow]);

  function confirm() {
    setConfirming(false);
    revoke();
  }

  function keepOnEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setConfirming(false);
    }
  }

  const revokeLabel = revoking ? t("tokens.revoking") : t("tokens.revoke");
  const rowState = revoked ? "revoked" : "live";
  const revokeHidden = revoked || confirming;
  const confirmShown = confirming && !revoked;

  return (
    <li
      className={styles["row"]}
      data-state={rowState}
      ref={rowRef}
      tabIndex={-1}
    >
      <div className={styles["text"]}>
        <span className={styles["name"]}>{name}</span>
        <span className={styles["meta"]}>{meta}</span>
      </div>
      {revokeHidden ? null : (
        <Button
          // Token-specific accessible name: rows must be distinguishable when
          // navigating by buttons.
          aria-label={t("tokens.ariaLabelRevoke", { name })}
          disabled={revokeInFlight}
          loading={revoking}
          ref={revokeRef}
          size="sm"
          onClick={() => setConfirming(true)}
        >
          {revokeLabel}
        </Button>
      )}
      {confirmShown ? (
        // The keydown is the row's Escape, not an interaction of its own.
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className={styles["confirm"]} onKeyDown={keepOnEscape}>
          <span id={warningId}>{t("tokens.revokeConfirm")}</span>
          <Button
            aria-describedby={warningId}
            ref={keepRef}
            size="sm"
            onClick={() => setConfirming(false)}
          >
            {t("tokens.keepToken")}
          </Button>
          <Button
            aria-describedby={warningId}
            aria-label={t("tokens.ariaLabelRevoke", { name })}
            disabled={revokeInFlight}
            size="sm"
            variant="danger-outline"
            onClick={confirm}
          >
            {t("tokens.revoke")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
