import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PRODUCT_NAME } from "./consts";
import styles from "./Header.module.scss";

export interface HeaderProps {
  /** What sits at the end of the tier: the Account menu once it exists. */
  end?: ReactNode;
}

/** The one-tier Header: the wordmark as a link to Home, and an end slot. */
export function Header({ end }: HeaderProps) {
  return (
    <header className={styles["header"]}>
      <div className={styles["inner"]}>
        <Link className={styles["wordmark"]} to="/">
          {PRODUCT_NAME}
        </Link>
        {end === undefined ? null : <div className={styles["end"]}>{end}</div>}
      </div>
    </header>
  );
}
