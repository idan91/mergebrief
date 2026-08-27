import { useTranslation } from "react-i18next";
import { useId, useState } from "react";

import type { UnattributedFileView } from "../../../../utils/viewModel";
import { formatRanges } from "../utils";
import { FileDiff } from "./FileDiff/FileDiff";
import styles from "./FileRow.module.scss";

export interface FileRowProps {
  file: UnattributedFileView;
}

/** One expandable unattributed file: path + counts + ranges → its diff rows. */
export function FileRow({ file }: FileRowProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const diffId = useId();

  return (
    <div className={styles["fileRow"]}>
      {/* eslint-disable-next-line no-restricted-syntax -- zero-chrome mono disclosure row: no shared component models a borderless, unpadded target */}
      <button
        aria-controls={open ? diffId : undefined}
        aria-expanded={open}
        className={styles["fileToggle"]}
        data-state={open ? "open" : "closed"}
        type="button"
        onClick={() => setOpen(!open)}
      >
        <span
          aria-hidden="true"
          className={styles["chevron"]}
          data-open={open || undefined}
        >
          ▸
        </span>

        <span className={styles["fileName"]}>{file.file}</span>

        <span className={styles["fileMeta"]}>
          {" · "}
          <span className="green">+{file.added}</span>{" "}
          <span className="red">−{file.deleted}</span>
          {" · "}
          {t("brief.unattributed.fileLines", { ranges: formatRanges(file) })}
        </span>
      </button>

      {open ? (
        <div id={diffId}>
          <FileDiff file={file} />
        </div>
      ) : null}
    </div>
  );
}
