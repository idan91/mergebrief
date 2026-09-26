import { useTranslation } from "react-i18next";

import { CopyButton } from "@web/components/CopyButton";
import { IconNames } from "@web/components/Icon/types";
import type { LineSelection } from "@web/features/review/utils";
import { deriveLineHash, deriveShareUrl } from "../../utils";
import styles from "./SelectionLinkGlyph.module.scss";

export interface SelectionLinkGlyphProps {
  selection: LineSelection;
}

/** The link glyph at a selection's first row: copies the page URL with the line hash. */
export function SelectionLinkGlyph({ selection }: SelectionLinkGlyphProps) {
  const { t } = useTranslation();
  const label =
    selection.startLine === selection.endLine
      ? t("brief.diff.copyLineLink", { line: selection.startLine })
      : t("brief.diff.copyLinesLink", {
          start: selection.startLine,
          end: selection.endLine,
        });

  return (
    <span className={styles["glyph"]} data-testid="selection-link-glyph">
      <CopyButton
        icon={IconNames.LINK}
        label={label}
        text={() => deriveShareUrl(window.location, deriveLineHash(selection))}
        title={label}
      />
    </span>
  );
}
