import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import MergeBriefMark from "../icons/mergebrief-mark.svg?react";
import MergeBriefWordmark from "../icons/mergebrief-wordmark.svg?react";
import { PRODUCT_NAME } from "./consts";
import styles from "./Header.module.scss";

export interface HeaderProps {
  /** What sits at the end of the tier: the Account menu once it exists. */
  end?: ReactNode;
}

/** The one-tier Header: the brand lockup as a link to Home, and an end slot. */
export function Header({ end }: HeaderProps) {
  return (
    <header className={styles["header"]}>
      <div className={styles["inner"]}>
        <Link aria-label={PRODUCT_NAME} className={styles["lockup"]} to="/">
          <MergeBriefMark
            aria-hidden="true"
            className={styles["mark"]}
            focusable="false"
          />
          <MergeBriefWordmark aria-hidden="true" focusable="false" />
        </Link>
        {end === undefined ? null : <div className={styles["end"]}>{end}</div>}
      </div>
    </header>
  );
}
