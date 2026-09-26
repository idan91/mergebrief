import { useTranslation } from "react-i18next";

import { CopyButton } from "@web/components/CopyButton";
import type { LineSelection } from "@web/features/review/utils";
import { deriveLineLink, deriveShareUrl } from "../../utils";
import styles from "./LineLinkButton.module.scss";

export interface LineLinkButtonProps {
  selection: LineSelection;
}

/** The selection's first line number as a button: copies the page URL with the line link. */
export function LineLinkButton({ selection }: LineLinkButtonProps) {
  const { t } = useTranslation();
  const label =
    selection.startLine === selection.endLine
      ? t("brief.diff.copyLineLink", { line: selection.startLine })
      : t("brief.diff.copyLinesLink", {
          start: selection.startLine,
          end: selection.endLine,
        });

  return (
    <span className={styles["slot"]} data-testid="line-link-button">
      <CopyButton
        className={styles["number"]}
        content={String(selection.startLine)}
        label={label}
        text={() => deriveShareUrl(window.location, deriveLineLink(selection))}
        title={label}
      />
    </span>
  );
}
