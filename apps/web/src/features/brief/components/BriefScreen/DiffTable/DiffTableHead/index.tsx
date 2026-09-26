import { useTranslation } from "react-i18next";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import styles from "./DiffTableHead.module.scss";

export interface DiffTableHeadProps {
  file: string;
  split: boolean;
  overlayActive: boolean;
}

/**
 * The split view's column widths and the sr-only caption and headers:
 * without them AT table navigation reads bare cell soup.
 */
export function DiffTableHead({
  file,
  split,
  overlayActive,
}: DiffTableHeadProps) {
  const { t } = useTranslation();

  return (
    <>
      {split ? (
        <colgroup>
          <col className={styles["rail"]} />
          <col className={styles["number"]} />
          <col className={styles["code"]} />
          <col className={styles["rail"]} />
          <col className={styles["number"]} />
          <col className={styles["code"]} />
        </colgroup>
      ) : null}
      <ScreenReaderOnly as="caption">
        {t("brief.diff.caption", { file })}
      </ScreenReaderOnly>
      <ScreenReaderOnly as="thead">
        <tr>
          <th aria-hidden={overlayActive ? undefined : true} scope="col">
            {overlayActive ? t("brief.diff.colRevision") : null}
          </th>
          {split ? (
            <>
              <th scope="col">{t("brief.diff.colOld")}</th>
              <th scope="col">{t("brief.diff.colContentOld")}</th>
              <th aria-hidden={overlayActive ? undefined : true} scope="col">
                {overlayActive ? t("brief.diff.colRevisionNew") : null}
              </th>
              <th scope="col">{t("brief.diff.colNew")}</th>
              <th scope="col">{t("brief.diff.colContentNew")}</th>
            </>
          ) : (
            <>
              <th scope="col">{t("brief.diff.colOld")}</th>
              <th scope="col">{t("brief.diff.colNew")}</th>
              <th scope="col">{t("brief.diff.colContent")}</th>
            </>
          )}
        </tr>
      </ScreenReaderOnly>
    </>
  );
}
