import { useState } from "react";

import { ExpandableContent } from "@web/components/ExpandableContent/ExpandableContent";
import { Markdown } from "@web/components/Markdown/Markdown";
import type { Brief } from "../../../types";
import { DeltaContext } from "../DeltaContext/DeltaContext";
import styles from "./SummarySection.module.scss";

export interface SummarySectionProps {
  brief: Brief;
}

/**
 * The Brief's summary block: single-column prose (BRIEF-104 retired the
 * BRIEF-4 two-column changelog split — an optional "## Changelog" renders as
 * plain markdown), plus the original-PR-description disclosure. The attribute
 * jump-rail is the single risk-surface summary (ADR 0032 #11) — this section
 * carries no risk chip lane of its own.
 */
export function SummarySection({ brief }: SummarySectionProps) {
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  return (
    <section
      className={`${styles["summary"]} reveal`}
      data-testid="brief-summary"
    >
      <div className={styles["eyebrow"]}>
        {brief.artifactKind === "delta" ? "Delta brief" : "Brief"}
      </div>
      <ExpandableContent testId="summary-prose">
        <div>
          <Markdown content={brief.summary} />
          {brief.artifactKind === "delta" ? (
            <DeltaContext brief={brief} />
          ) : null}
          {/* Nested inside the cap (BRIEF-134): the disclosure is part of the
              summary content, and focusing it expands the cap around it. */}
          <button
            className={styles["descriptionToggle"]}
            data-testid="pr-description-toggle"
            type="button"
            onClick={() => setDescriptionOpen((current) => !current)}
          >
            {descriptionOpen
              ? "Hide original PR description"
              : "Show original PR description"}
          </button>
          {descriptionOpen ? (
            <div className={styles["description"]} data-testid="pr-description">
              <div className={styles["eyebrow"]}>Original PR description</div>
              <Markdown
                content={
                  brief.pr.description || "_No PR description provided._"
                }
              />
            </div>
          ) : null}
        </div>
      </ExpandableContent>
    </section>
  );
}
