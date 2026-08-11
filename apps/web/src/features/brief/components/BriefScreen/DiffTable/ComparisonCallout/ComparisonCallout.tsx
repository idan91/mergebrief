import { useTranslation } from "react-i18next";
import { Callout } from "@web/components/Callout/Callout";
import {
  bindComparisonCallout,
  type ComparisonRun,
  type ComparisonSource,
} from "../../../../comparison/comparison";
import type {
  BriefChunk,
  RevisionNarrativeSkipReason,
} from "../../../../types";

import styles from "./ComparisonCallout.module.scss";

export interface ComparisonCalloutProps {
  /** The rail element the callout anchors to. */
  anchor: Element;
  /** Hover left the rail + callout system; the parent unmounts. */
  onClose: () => void;
  run: ComparisonRun;
  chunk: BriefChunk;
  source: ComparisonSource;
  /**
   * When the Previous-Brief narrative was deliberately skipped, the reason —
   * conveyed as a distinct "skipped" state, not a failure.
   */
  skipReason: RevisionNarrativeSkipReason | null;
}

export function ComparisonCallout({
  anchor,
  onClose,
  run,
  chunk,
  source,
  skipReason,
}: ComparisonCalloutProps) {
  const { t } = useTranslation();
  const callout = bindComparisonCallout(run, chunk, source);
  const verb = run.kind === "removed" ? "Removed" : "New";
  const eyebrow =
    source.kind === "last-review"
      ? `${verb} since your last review`
      : `${verb} this revision`;
  return (
    <Callout anchor={anchor} onClose={onClose} placement="right-start">
      <Callout.Eyebrow>{eyebrow}</Callout.Eyebrow>
      {callout.available ? (
        <>
          {/* The summary cap is warn-only upstream, so the clamp here is what
              keeps a non-compliant model from exploding the callout. */}
          {callout.summary && (
            <Callout.Title clamp={4}>{callout.summary}</Callout.Title>
          )}
          {callout.groupTitle && (
            <Callout.Context>In: {callout.groupTitle}</Callout.Context>
          )}
          {callout.degraded && (
            <Callout.Context>
              <span className={styles["unavailable"]}>
                Span summary unavailable — showing group context.
              </span>
            </Callout.Context>
          )}
        </>
      ) : (
        <Callout.Body>
          <span className={styles["unavailable"]}>
            {skipReason
              ? t("brief.diff.summarySkipped", { reason: skipReason })
              : t("brief.diff.summaryUnavailable")}
          </span>
        </Callout.Body>
      )}
    </Callout>
  );
}
