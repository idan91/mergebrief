import { useTranslation } from "react-i18next";
import type { SuggestionDiffRow } from "../utils";
import styles from "./SuggestionCard.module.scss";

export interface SuggestionCardProps {
  rows: SuggestionDiffRow[];
}

/**
 * Anchored consumers pass del+add rows with line numbers; anchor-less
 * consumers pass addition-only rows and the number columns collapse.
 */
export function SuggestionCard({ rows }: SuggestionCardProps) {
  const { t } = useTranslation();
  const withNumbers = rows.some(
    (row) => row.oldLine !== undefined || row.newLine !== undefined,
  );
  return (
    <div className={styles["suggestionCard"]}>
      <div className={styles["suggestionTitle"]}>
        {t("shell.suggestedChange")}
      </div>
      <table
        className={styles["suggestionDiff"]}
        aria-label={t("shell.ariaLabelSuggestedDiff")}
      >
        {withNumbers ? (
          <colgroup>
            <col className={styles["lineCol"]} />
            <col className={styles["lineCol"]} />
            <col />
          </colgroup>
        ) : null}
        <tbody>
          {rows.map((row, index) => (
            <tr
              className={styles["line"]}
              data-line-kind={row.kind}
              key={`${row.kind}-${index}`}
            >
              {withNumbers ? (
                <>
                  <td className={styles["lineNumber"]}>{row.oldLine ?? ""}</td>
                  <td className={styles["lineNumber"]}>{row.newLine ?? ""}</td>
                </>
              ) : null}
              <td className={styles["code"]}>
                <span className={styles["sign"]}>
                  {row.kind === "add" ? "+" : "−"}
                </span>
                {row.content}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
