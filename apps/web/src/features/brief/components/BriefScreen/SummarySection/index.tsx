import { useTranslation } from "react-i18next";
import { useState } from "react";

import { ExpandableContent } from "@web/components/ExpandableContent";
import { LinkButton } from "@web/components/LinkButton";
import { Markdown } from "@web/components/Markdown";
import type { Brief } from "../../../types";
import { DeltaContext } from "../DeltaContext";
import styles from "./SummarySection.module.scss";

export interface SummarySectionProps {
  brief: Brief;
}

/**
 * The Brief's summary block: single-column text (an optional "## Changelog"
 * renders as plain markdown, never a second column), plus the
 * original-PR-description disclosure. The attribute jump-rail is the single
 * risk-surface summary, this section carries no risk chip lane of its own.
 */
export function SummarySection({ brief }: SummarySectionProps) {
  const { t } = useTranslation();
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  return (
    <section
      className={`${styles["summary"]} reveal`}
      data-testid="brief-summary"
    >
      <div className={styles["eyebrow"]}>
        {brief.artifactKind === "delta"
          ? t("brief.summarySection.eyebrowDelta")
          : t("brief.summarySection.eyebrowBrief")}
      </div>
      <ExpandableContent testId="summary-text">
        <div>
          <Markdown content={brief.summary} />
          {brief.artifactKind === "delta" ? (
            <DeltaContext brief={brief} />
          ) : null}
          {/* Nested inside the cap: the disclosure is part of the summary
              content, and focusing it expands the cap around it. */}
          <LinkButton
            aria-expanded={descriptionOpen}
            className={styles["descriptionToggle"]}
            data-testid="pr-description-toggle"
            onClick={() => setDescriptionOpen((current) => !current)}
          >
            {descriptionOpen
              ? t("brief.summarySection.hideDescription")
              : t("brief.summarySection.showDescription")}
          </LinkButton>
          {descriptionOpen ? (
            <div className={styles["description"]} data-testid="pr-description">
              <div className={styles["eyebrow"]}>
                {t("brief.summarySection.originalDescription")}
              </div>
              <Markdown
                content={
                  brief.pr.description ||
                  t("brief.summarySection.noDescription")
                }
              />
            </div>
          ) : null}
        </div>
      </ExpandableContent>
    </section>
  );
}
