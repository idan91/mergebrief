import { useTranslation } from "react-i18next";
import { useState } from "react";

import { CollapsibleBar } from "@web/components/CollapsibleBar";
import {
  BarHeadingLevels,
  BarVariants,
} from "@web/components/CollapsibleBar/types";
import { Markdown } from "@web/components/Markdown";
import { countWords } from "./utils";
import styles from "./OriginalDescription.module.scss";

export interface OriginalDescriptionProps {
  /** The PR description as the author wrote it. */
  description: string;
}

/** The author's own PR description, closed under the summary until asked for. */
export function OriginalDescription({ description }: OriginalDescriptionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const words = countWords(description);
  const meta =
    words === 0
      ? t("brief.masthead.descriptionEmpty")
      : t("brief.masthead.descriptionWords", { count: words });
  const content =
    words === 0 ? t("brief.summarySection.noDescription") : description;

  return (
    <CollapsibleBar
      className={styles["description"]}
      data-testid="pr-description"
      headingLevel={BarHeadingLevels.H2}
      open={open}
      summary={meta}
      title={t("brief.masthead.originalDescription")}
      variant={BarVariants.ROW}
      onToggle={() => setOpen((current) => !current)}
    >
      {open ? <Markdown content={content} renderHtml renderMentions /> : null}
    </CollapsibleBar>
  );
}
