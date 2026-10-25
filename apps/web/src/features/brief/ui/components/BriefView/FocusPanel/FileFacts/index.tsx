import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { BriefChunk } from "../../../../../model/types";
import { isUnattributedRemainderChunk } from "../../../../../model/utils/remainder";
import {
  getConcernLabel,
  getRoleLabel,
} from "../../../../../model/utils/view-model";
import type { AttributeDisplayMeta } from "../../../../../model/utils/repo-config";
import { splitFilePath } from "../../utils";
import { ChunkRisks } from "./ChunkRisks";
import styles from "./FileFacts.module.scss";

export interface FileFactsProps {
  chunk: BriefChunk;
  riskMeta: ReadonlyMap<string, AttributeDisplayMeta> | undefined;
  /** The remainder group has no risk section. */
  showRisks: boolean;
}

export function FileFacts({ chunk, riskMeta, showRisks }: FileFactsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const path = splitFilePath(chunk.file);
  const remainderChunk = isUnattributedRemainderChunk(chunk);
  const concernLabel = getConcernLabel(t, chunk.concern);
  const roleLabel = getRoleLabel(t, chunk.role);

  return (
    <section aria-labelledby={headingId} className={styles["fileFacts"]}>
      <h3 className={styles["label"]} id={headingId}>
        {t("brief.focusPanel.thisFile")}
      </h3>
      <p className={styles["path"]}>
        {path.directories.map((part) => (
          <span className={styles["directory"]} key={part.key}>
            {part.text}
            <wbr />
          </span>
        ))}
        <span className={styles["basename"]}>{path.basename}</span>
      </p>
      {remainderChunk ? null : (
        <dl className={styles["facts"]}>
          <div>
            <dt>{t("brief.focusPanel.concern")}</dt>
            <dd>{concernLabel}</dd>
          </div>
          <div>
            <dt>{t("brief.focusPanel.role")}</dt>
            <dd>{roleLabel}</dd>
          </div>
        </dl>
      )}
      {showRisks ? <ChunkRisks chunk={chunk} riskMeta={riskMeta} /> : null}
    </section>
  );
}
