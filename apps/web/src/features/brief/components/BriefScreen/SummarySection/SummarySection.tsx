import { useState } from "react";

import { Markdown } from "@web/components/Markdown/Markdown";
import type { Brief } from "../../../types";
import { splitSummaryAtChangelog } from "../../../utils/viewModel";
import { DeltaContext } from "../DeltaContext/DeltaContext";
import styles from "./SummarySection.module.scss";

export interface SummarySectionProps {
  brief: Brief;
}

/**
 * The Brief's summary block: single-column prose, or (BRIEF-4) a two-column
 * split at the optional "## Changelog" h2 on wide containers, plus the
 * original-PR-description disclosure. The attribute jump-rail is the single
 * risk-surface summary (ADR 0032 #11) — this section carries no risk chip
 * lane of its own.
 */
export function SummarySection({ brief }: SummarySectionProps) {
  // No changelog → single-column render, unchanged DOM.
  const summaryParts = splitSummaryAtChangelog(brief.summary);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  return (
    <section
      className={`${styles["summary"]} reveal`}
      data-testid="brief-summary"
      data-summary-split={summaryParts.changelog === undefined ? undefined : ""}
    >
      <div className={styles["eyebrow"]}>
        {brief.artifactKind === "delta" ? "Delta brief" : "Brief"}
      </div>
      {/* BRIEF-4: with a changelog the summary renders as two grid regions —
          lead prose | changelog (+ delta context). DOM order stays overview →
          what-it-does → changelog; wide-container placement is grid-only
          (reading order, a11y). */}
      {summaryParts.changelog === undefined ? (
        <Markdown content={brief.summary} />
      ) : (
        <div className={styles["summaryColumns"]}>
          <div className={styles["summaryLead"]}>
            <Markdown content={summaryParts.lead} />
          </div>
          <div className={styles["summaryAside"]}>
            <Markdown content={summaryParts.changelog} />
            {brief.artifactKind === "delta" ? (
              <DeltaContext brief={brief} />
            ) : null}
          </div>
        </div>
      )}
      {summaryParts.changelog === undefined &&
      brief.artifactKind === "delta" ? (
        <DeltaContext brief={brief} />
      ) : null}
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
            content={brief.pr.description || "_No PR description provided._"}
          />
        </div>
      ) : null}
    </section>
  );
}
