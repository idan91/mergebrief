import { useId } from "react";
import { useTranslation } from "react-i18next";

import { renderedLocale } from "@web/i18n/locale";
import { MediaTile } from "./MediaTile";
import type { StripEntry } from "./types";
import { describeStripCounts } from "./utils";
import styles from "./MediaStrip.module.scss";

export interface MediaStripProps {
  entries: readonly StripEntry[];
}

/** A thumbnail for every Media item in the description; nothing when it has none. */
export function MediaStrip({ entries }: MediaStripProps) {
  const { t, i18n } = useTranslation();
  const headingId = useId();

  if (entries.length === 0) {
    return null;
  }

  const locale = renderedLocale(i18n.resolvedLanguage);
  const counts = describeStripCounts(t, entries, locale);
  return (
    <section
      aria-labelledby={headingId}
      className={styles["strip"]}
      data-testid="media-strip"
    >
      <div className={styles["head"]}>
        <h2 className={styles["title"]} id={headingId}>
          {t("brief.media.title")}
        </h2>
        <span className={styles["counts"]}>{counts}</span>
      </div>
      <ul className={styles["row"]}>
        {entries.map((entry) => (
          <MediaTile entry={entry} key={entry.key} />
        ))}
      </ul>
    </section>
  );
}
