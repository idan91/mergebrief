import type { SignInFailure } from "contract";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { buildSignInHref } from "@web/data/sign-in";
import { Button } from "../Button";
import { PRODUCT_NAME } from "../Header/consts";
import { Icon } from "../Icon";
import { IconNames } from "../Icon/types";
import MergeBriefMark from "../icons/mergebrief-mark.svg?react";
import MergeBriefWordmark from "../icons/mergebrief-wordmark.svg?react";
import { FailureBox } from "./FailureBox";
import styles from "./SignInPage.module.scss";

export interface SignInPageProps {
  heading: string;
  lead?: string;
  /** The page to land back on after GitHub; absent signs in to Home. */
  returnTo?: string | undefined;
  /** Why the last sign-in failed, when the visitor came back from one. */
  failure?: SignInFailure | undefined;
}

/** The whole screen for a visitor with no session: one panel, one action, no chrome. */
export function SignInPage({
  heading,
  lead,
  returnTo,
  failure,
}: SignInPageProps) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // Swapped in for a screen whose focused control it unmounted.
  useEffect(() => {
    if (document.activeElement === document.body) {
      mainRef.current?.focus({ preventScroll: true });
    }
  }, []);

  // Back from GitHub can restore this page from the back/forward cache, state included.
  useEffect(() => {
    function resetOpening() {
      setOpening(false);
    }
    window.addEventListener("pageshow", resetOpening);
    return () => window.removeEventListener("pageshow", resetOpening);
  }, []);

  function markOpening(event: MouseEvent<HTMLAnchorElement>) {
    const opensElsewhere =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (!opensElsewhere) {
      setOpening(true);
    }
  }

  const href = buildSignInHref(returnTo);
  const label = opening
    ? t("shell.signIn.opening")
    : t("home.signedOut.signIn");
  const ariaBusy = opening ? true : undefined;

  return (
    <main
      className={styles["page"]}
      id="main-content"
      ref={mainRef}
      tabIndex={-1}
    >
      <div className={styles["panel"]}>
        <div className={styles["top"]}>
          <span
            aria-label={PRODUCT_NAME}
            className={styles["lockup"]}
            role="img"
          >
            <MergeBriefMark
              aria-hidden="true"
              className={styles["mark"]}
              focusable="false"
            />
            <MergeBriefWordmark aria-hidden="true" focusable="false" />
          </span>
          <div className={styles["head"]}>
            <h1 className={styles["heading"]}>{heading}</h1>
            {lead === undefined ? null : (
              <p className={styles["lead"]}>{lead}</p>
            )}
          </div>
          {failure === undefined ? null : <FailureBox failure={failure} />}
          <Button
            as="a"
            className={styles["signIn"]}
            href={href}
            aria-busy={ariaBusy}
            variant="primary"
            onClick={markOpening}
          >
            {opening ? (
              <span aria-hidden="true" className={styles["spinner"]} />
            ) : (
              <Icon name={IconNames.GITHUB_LOGO} />
            )}
            {label}
          </Button>
        </div>
        <div className={styles["footer"]}>
          <p>{t("shell.signIn.note")}</p>
        </div>
      </div>
    </main>
  );
}
