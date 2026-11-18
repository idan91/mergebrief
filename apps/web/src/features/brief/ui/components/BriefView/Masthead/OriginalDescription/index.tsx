import { Trans, useTranslation } from "react-i18next";
import { useState } from "react";

import { CollapsibleBar } from "@web/components/CollapsibleBar";
import { BarHeadingLevels } from "@web/components/CollapsibleBar/types";
import { Markdown } from "@web/components/Markdown";
import { countWords } from "./utils";
import styles from "./OriginalDescription.module.scss";

export interface OriginalDescriptionProps {
  /** The PR description as the author wrote it. */
  description: string;
}

/** The author's own PR description, closed in the masthead's folds until asked for. */
export function OriginalDescription({ description }: OriginalDescriptionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const words = countWords(description);
  const wordsText = String(words);
  const meta =
    words === 0 ? (
      t("brief.masthead.descriptionEmpty")
    ) : (
      <Trans
        components={[
          <b className={styles["count"]} key="count">
            {wordsText}
          </b>,
        ]}
        count={words}
        i18nKey="brief.masthead.descriptionWords"
      />
    );
  const content =
    words === 0 ? t("brief.summarySection.noDescription") : description;

  return (
    <CollapsibleBar
      data-testid="pr-description"
      headingLevel={BarHeadingLevels.H2}
      open={open}
      summary={meta}
      title={t("brief.masthead.originalDescription")}
      onToggle={() => setOpen((current) => !current)}
    >
      {open ? <Markdown content={content} renderHtml renderMentions /> : null}
    </CollapsibleBar>
  );
}
