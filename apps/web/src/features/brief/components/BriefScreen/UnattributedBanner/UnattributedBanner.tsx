import { useTranslation } from "react-i18next";
import { useId, useState } from "react";

import type { UnattributedView } from "../../../utils/viewModel";
import { FileRow } from "./FileRow/FileRow";
import styles from "./UnattributedBanner.module.scss";

export interface UnattributedBannerProps {
  /** The brief's unattributed remainder (non-empty at this render). */
  view: UnattributedView;
}

/**
 * The thin between-summary-and-toolbar banner: the unattributed remainder's
 * counts plus a per-file "Show lines" expansion rendering the actual diff
 * rows. Plain hairline border — informational, never an alarm.
 */
export function UnattributedBanner({ view }: UnattributedBannerProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const detailId = useId();

  return (
    <aside
      aria-label={t("brief.unattributed.calloutTitle")}
      className={styles["banner"]}
      data-state={open ? "open" : "closed"}
      data-testid="unattributed-banner"
    >
      <div className={styles["row"]}>
        <span aria-hidden="true" className={styles["warnDot"]} />

        <span className={styles["text"]}>
          <b>
            <span className="green">+{view.added}</span>{" "}
            <span className="red">−{view.deleted}</span>
          </b>{" "}
          {t("brief.unattributed.bannerRest", { count: view.files.length })}
        </span>

        <button
          aria-controls={open ? detailId : undefined}
          aria-expanded={open}
          className={styles["toggle"]}
          data-testid="unattributed-banner-toggle"
          type="button"
          onClick={() => setOpen(!open)}
        >
          {open
            ? t("brief.unattributed.hideLines")
            : t("brief.unattributed.showLines")}
        </button>
      </div>

      {open ? (
        <div className={styles["detail"]} id={detailId}>
          {view.files.map((file) => (
            <FileRow file={file} key={file.file} />
          ))}
        </div>
      ) : null}
    </aside>
  );
}
