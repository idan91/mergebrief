import { useId } from "react";
import { useTranslation } from "react-i18next";

import { LocSign, LocSigns } from "@web/components/LocSign";
import type { BriefChunk } from "../../../../types";
import { isUnattributedRemainderChunk } from "../../../../utils/remainder";
import type { AttributeDisplayMeta } from "../../../../utils/repoConfig";
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
      <dl className={styles["facts"]}>
        {remainderChunk ? null : (
          <>
            <div>
              <dt>{t("brief.focusPanel.concern")}</dt>
              <dd>{chunk.concern}</dd>
            </div>
            <div>
              <dt>{t("brief.focusPanel.role")}</dt>
              <dd>{chunk.role}</dd>
            </div>
          </>
        )}
        <div>
          <dt>{t("brief.focusPanel.lines")}</dt>
          <dd>
            <LocSign sign={LocSigns.ADD} count={chunk.loc.added} />{" "}
            <LocSign sign={LocSigns.DEL} count={chunk.loc.deleted} />
          </dd>
        </div>
      </dl>
      {showRisks ? <ChunkRisks chunk={chunk} riskMeta={riskMeta} /> : null}
    </section>
  );
}
