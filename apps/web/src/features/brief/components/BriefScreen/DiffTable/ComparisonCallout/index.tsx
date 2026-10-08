import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Callout } from "@web/components/Callout";
import {
  bindComparisonCallout,
  type ComparisonCalloutContent,
  type ComparisonRun,
  type ComparisonSource,
} from "../../../../comparison/runs";
import {
  RevisionNarrativeSkipReasons,
  type BriefChunk,
  type RevisionNarrativeSkipReason,
} from "../../../../types";

import styles from "./ComparisonCallout.module.scss";
import type { TranslationKey } from "i18n";

const SKIP_REASON_KEYS: Record<RevisionNarrativeSkipReason, TranslationKey> = {
  [RevisionNarrativeSkipReasons.SPAN_TOO_LARGE]:
    "brief.diff.skipReasonSpanTooLarge",
  [RevisionNarrativeSkipReasons.DISABLED_BY_CONFIG]:
    "brief.diff.skipReasonDisabledByConfig",
};

export interface ComparisonCalloutProps {
  /** The rail element the callout anchors to. */
  anchor: Element;
  /** Hover left the rail + callout system; the parent unmounts. */
  onClose: () => void;
  run: ComparisonRun;
  chunk: BriefChunk;
  source: ComparisonSource;
  /**
   * When the Previous-Brief narrative was deliberately skipped, the reason,
   * conveyed as a distinct "skipped" state, not a failure.
   */
  skipReason: RevisionNarrativeSkipReason | null;
}

const EYEBROW_KEYS = {
  LAST_REVIEW: {
    REMOVED: "brief.diff.calloutRemovedSinceLastReview",
    NEW: "brief.diff.calloutNewSinceLastReview",
  },
  REVISION: {
    REMOVED: "brief.diff.calloutRemovedThisRevision",
    NEW: "brief.diff.calloutNewThisRevision",
  },
} as const;

function deriveEyebrowKey(runKind: string, sourceKind: string): TranslationKey {
  const bySource =
    sourceKind === "last-review"
      ? EYEBROW_KEYS.LAST_REVIEW
      : EYEBROW_KEYS.REVISION;
  return runKind === "removed" ? bySource.REMOVED : bySource.NEW;
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
  const eyebrow = t(deriveEyebrowKey(run.kind, source.kind));
  const groupName = resolveCalloutGroup(t, callout);
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
          {groupName ? (
            <Callout.Context>
              {t("brief.diff.calloutIn", { group: groupName })}
            </Callout.Context>
          ) : null}
          {callout.degraded && (
            <Callout.Context>
              <span className={styles["unavailable"]}>
                {t("brief.diff.spanSummaryUnavailable")}
              </span>
            </Callout.Context>
          )}
        </>
      ) : (
        <Callout.Body>
          <span className={styles["unavailable"]}>
            {skipReason
              ? t("brief.diff.summarySkipped", {
                  reason: t(SKIP_REASON_KEYS[skipReason]),
                })
              : t("brief.diff.summaryUnavailable")}
          </span>
        </Callout.Body>
      )}
    </Callout>
  );
}

function resolveCalloutGroup(
  t: TFunction,
  callout: ComparisonCalloutContent,
): string | undefined {
  if (callout.remainder) {
    return t("brief.unattributed.remainderTitle");
  }
  return callout.groupTitle;
}
