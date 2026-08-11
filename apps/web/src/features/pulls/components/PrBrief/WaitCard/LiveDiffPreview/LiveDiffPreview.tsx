import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { parseUnifiedDiffPatch } from "../../../../../brief/utils/diffSlicing";
import type { DiffLine } from "../../../../../brief/types";
import type { Span } from "../../../../utils/briefRouteState";
import { splitUnifiedDiffByFile } from "../../../../utils/liveDiff";
import { prDiffQueryOptions } from "../../../../queries";
import cardStyles from "../../stateCard.module.scss";
import styles from "./LiveDiffPreview.module.scss";

export interface LiveDiffPreviewProps {
  repoId: string;
  prNumber: number;
  span: Span;
}

interface FileRows {
  readonly file: string;
  readonly rows: DiffLine[];
}

/**
 * Read-only whole-PR diff for the wait screen. Deliberately NOT the chunk
 * DiffTable (that one is wired to review comments/comparisons).
 */
export function LiveDiffPreview({
  repoId,
  prNumber,
  span,
}: LiveDiffPreviewProps) {
  const { t } = useTranslation();
  const diff = useQuery(
    prDiffQueryOptions(repoId, prNumber, span.base, span.head),
  );
  const files: FileRows[] = useMemo(() => {
    if (diff.data === undefined) return [];
    return [...splitUnifiedDiffByFile(diff.data)].map(([file, patch]) => ({
      file,
      rows: parseUnifiedDiffPatch(patch),
    }));
  }, [diff.data]);

  if (diff.isPending) {
    return <p className={cardStyles["meta"]}>{t("pulls.wait.diffLoading")}</p>;
  }
  if (diff.isError || files.length === 0) {
    return (
      <p className={cardStyles["meta"]}>{t("pulls.wait.diffUnavailable")}</p>
    );
  }
  return (
    <div className={styles["diff"]}>
      {files.map(({ file, rows }) => (
        <details
          className={styles["diffFile"]}
          key={file}
          open={files.length <= 5}
        >
          <summary>{file}</summary>
          <table className={styles["diffTable"]}>
            <ScreenReaderOnly as="caption">
              {t("pulls.wait.diffCaption", { file })}
            </ScreenReaderOnly>
            <ScreenReaderOnly as="thead">
              <tr>
                <th scope="col">{t("pulls.wait.diffColOld")}</th>
                <th scope="col">{t("pulls.wait.diffColNew")}</th>
                <th scope="col">{t("pulls.wait.diffColContent")}</th>
              </tr>
            </ScreenReaderOnly>
            <tbody>
              {rows.map((row, index) => (
                <tr data-kind={row.kind} key={`${file}:${String(index)}`}>
                  <td className={styles["lineNo"]}>{row.oldLine ?? ""}</td>
                  <td className={styles["lineNo"]}>{row.newLine ?? ""}</td>
                  <td className={styles["lineContent"]}>{row.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}
