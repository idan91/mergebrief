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
   * conveyed as a distinct "skipped" state, not a failure (ADR 0024).
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
          {/* Payload first: WHAT changed is the prominent text; the owning
              change-group is a de-emphasized provenance line under it. */}
          {/* Display-side guard (BRIEF-148): the prompt caps chunk summaries
              at ~150 chars but the floor is warn-only — a non-compliant
              model must degrade to a clamped callout, never an exploded one. */}
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
              ? `Summary skipped — ${skipReason}.`
              : "Summary unavailable for this span."}
          </span>
        </Callout.Body>
      )}
    </Callout>
  );
}
