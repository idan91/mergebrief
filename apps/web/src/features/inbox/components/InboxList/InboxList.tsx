import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAnnouncer } from "@web/hooks/useAnnouncer";
import { useTranslation } from "react-i18next";
import type { InboxSort } from "types/inbox";

import { FIRST_LOAD_SETTLE_MS } from "../../consts";
import type { InboxItem } from "../../types";
import { splitAtFold } from "../../utils";
import styles from "./InboxList.module.scss";
import { InboxRow } from "./InboxRow/InboxRow";
import { useInboxCursor } from "./useInboxCursor";

export interface InboxListProps {
  items: readonly InboxItem[];
  sort: InboxSort;
  /** The filters and the sort, on the heading's line. */
  controls?: ReactNode;
}

/**
 * The list under its heading, split at the fold: rows that need the
 * reviewer, a quiet line, then the rest. Each side keeps the server order.
 * On first load the rows fade up with a short stagger; the attribute that
 * arms it leaves once the last row has landed, so a later re-read replays
 * nothing. The keyboard cursor counts rows straight through both sides,
 * and one live region below the list announces what a row action did.
 */
export function InboxList({ items, sort, controls }: InboxListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const firstLoad = useFirstLoad();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cursorRowRef = useRef<HTMLLIElement>(null);
  const announcer = useAnnouncer();
  const { above, below } = splitAtFold(items);
  const ordered = [...above, ...below];
  const cursor = useInboxCursor(ordered.length, (index) => {
    const item = ordered[index];
    if (item === undefined) {
      return;
    }
    void navigate({
      to: "/repos/$repoId/pulls/$prNumber",
      params: { repoId: item.repoId, prNumber: String(item.prNumber) },
    });
  });
  const now = new Date();
  const showFold = above.length > 0 && below.length > 0;

  // The page scrolls smoothly for anchors; a key press must land at once.
  useEffect(() => {
    cursorRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }, [cursor]);

  // The row's menu returns focus to its trigger as it leaves; the heading
  // takes it on the next frame, after that trigger is gone with the row.
  const handleDeleted = useCallback((): void => {
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  return (
    <section aria-labelledby="inbox-heading" className={styles["inbox"]}>
      <div className={styles["head"]}>
        <h2
          className={styles["heading"]}
          id="inbox-heading"
          ref={headingRef}
          tabIndex={-1}
        >
          {t("home.inbox.heading")}
        </h2>
        {controls}
      </div>
      <div className={styles["list"]} data-first-load={firstLoad}>
        {above.length === 0 ? null : (
          <ol className={styles["rows"]}>
            {above.map((item, index) => (
              <InboxRow
                cursor={index === cursor}
                index={index}
                item={item}
                key={`${item.repoId}/${item.prNumber}/${item.source}`}
                now={now}
                rowRef={index === cursor ? cursorRowRef : undefined}
                sort={sort}
                onAnnounce={announcer.announce}
                onDeleted={handleDeleted}
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
                cursor={above.length + index === cursor}
                index={above.length + index}
                item={item}
                key={`${item.repoId}/${item.prNumber}/${item.source}`}
                now={now}
                rowRef={
                  above.length + index === cursor ? cursorRowRef : undefined
                }
                sort={sort}
                onAnnounce={announcer.announce}
                onDeleted={handleDeleted}
              />
            ))}
          </ol>
        )}
      </div>
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {announcer.text}
      </p>
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
