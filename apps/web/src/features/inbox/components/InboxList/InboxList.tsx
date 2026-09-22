import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InboxSort } from "types/inbox";

import { FIRST_LOAD_SETTLE_MS } from "../../consts";
import type { InboxItem } from "../../types";
import { splitAtFold } from "../../utils";
import styles from "./InboxList.module.scss";
import { InboxRow } from "./InboxRow/InboxRow";

export interface InboxListProps {
  items: readonly InboxItem[];
  sort: InboxSort;
}

/**
 * The list under its heading, split at the fold: rows that need the
 * reviewer, a quiet line, then the rest. Each side keeps the server order.
 * On first load the rows fade up with a short stagger; the attribute that
 * arms it leaves once the last row has landed, so a later re-read replays
 * nothing.
 */
export function InboxList({ items, sort }: InboxListProps) {
  const { t } = useTranslation();
  const firstLoad = useFirstLoad();
  const { above, below } = splitAtFold(items);
  const now = new Date();
  const showFold = above.length > 0 && below.length > 0;

  return (
    <section aria-labelledby="inbox-heading" className={styles["inbox"]}>
      <h2 className={styles["heading"]} id="inbox-heading">
        {t("home.inbox.heading")}
      </h2>
      <div className={styles["list"]} data-first-load={firstLoad}>
        {above.length === 0 ? null : (
          <ol className={styles["rows"]}>
            {above.map((item, index) => (
              <InboxRow
                index={index}
                item={item}
                key={`${item.repoId}/${item.prNumber}/${item.source}`}
                now={now}
                sort={sort}
              />
            ))}
          </ol>
        )}
        {showFold ? (
          <p className={styles["fold"]}>{t("home.inbox.fold")}</p>
        ) : null}
        {below.length === 0 ? null : (
          <ol className={styles["rows"]}>
            {below.map((item, index) => (
              <InboxRow
                index={above.length + index}
                item={item}
                key={`${item.repoId}/${item.prNumber}/${item.source}`}
                now={now}
                sort={sort}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function useFirstLoad(): boolean {
  const [firstLoad, setFirstLoad] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFirstLoad(false),
      FIRST_LOAD_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);
  return firstLoad;
}
