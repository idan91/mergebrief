import type { ReactNode } from "react";

import { EmptyBlock } from "../EmptyBlock";
import { Header } from "../Header";
import styles from "./StatePage.module.scss";

export interface StatePageProps {
  /** What sits at the end of the Header: the Account menu, unless the page's own action is Sign in. */
  headerEnd?: ReactNode;
  heading: string;
  detail?: string | undefined;
  /** The one way on: a link home, or Sign in. */
  action: ReactNode;
}

/** A screen whose whole content is one state: the Header over one block. */
export function StatePage({
  headerEnd,
  heading,
  detail,
  action,
}: StatePageProps) {
  return (
    <div className={styles["page"]}>
      <Header end={headerEnd} />
      <main className={styles["main"]} id="main-content" tabIndex={-1}>
        <EmptyBlock
          action={<div className={styles["action"]}>{action}</div>}
          detail={detail}
          heading={<h1>{heading}</h1>}
        />
      </main>
    </div>
  );
}
