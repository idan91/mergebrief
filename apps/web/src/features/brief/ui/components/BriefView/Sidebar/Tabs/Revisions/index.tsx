import { useTranslation } from "react-i18next";
import type { Ref } from "react";

import { formatDate, renderedLocale } from "@web/i18n/locale";
import type {
  RevisionRow,
  RevisionTimelinePlan,
} from "../../../../../../model/types";
import styles from "./Revisions.module.scss";

export interface RevisionsProps {
  plan: RevisionTimelinePlan;
  /** Runs after any row activates; the sheet collapses on the narrow band. */
  afterActivate: () => void;
  /** Attached to the current row, so the sidebar can hand focus back to it. */
  currentRowRef?: Ref<HTMLButtonElement> | undefined;
}

/**
 * The Revisions tab's content: the PR's revisions newest first on one
 * spine, the current one marked, each row a way to that revision.
 */
export function Revisions({
  plan,
  afterActivate,
  currentRowRef,
}: RevisionsProps) {
  const { i18n, t } = useTranslation();
  const locale = renderedLocale(i18n.resolvedLanguage);

  const activate = (row: RevisionRow) => {
    if (!row.current) {
      plan.selectRevision(row.key);
    }
    afterActivate();
  };

  return (
    <div className={styles["panel"]}>
      <ol className={styles["list"]} data-testid="revision-list">
        {plan.view.rows.map((row) => {
          const date =
            row.at === undefined
              ? undefined
              : formatDate(row.at, locale, { dateStyle: "medium" });
          const rowRef = row.current ? currentRowRef : undefined;
          return (
            <li key={row.key}>
              {/* oxlint-disable-next-line house/no-raw-button -- two-line list row on an alignment grid: block content the shared Button does not model */}
              <button
                aria-current={row.current ? "true" : undefined}
                className={styles["row"]}
                data-current={row.current ? "" : undefined}
                ref={rowRef}
                type="button"
                onClick={() => activate(row)}
              >
                <span aria-hidden="true" className={styles["node"]} />
                <span className={styles["name"]}>
                  {t("brief.sidebar.revisions.title", { index: row.ordinal })}
                </span>
                {row.newest ? (
                  <span className={styles["latest"]}>
                    {t("brief.sidebar.revisions.latest")}
                  </span>
                ) : null}
                <span className={styles["meta"]}>
                  <span className={styles["sha"]}>{row.shortSha}</span>
                  {date === undefined ? null : <span>{date}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
