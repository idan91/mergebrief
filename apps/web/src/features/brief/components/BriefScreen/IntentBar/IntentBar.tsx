import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { ExpandableContent } from "@web/components/ExpandableContent/ExpandableContent";
import type { IntentCheck, IntentItem } from "../../../types";
import styles from "./IntentBar.module.scss";

export interface IntentBarProps {
  intentCheck: IntentCheck;
  /** Reuses the BriefScreen group-jump machinery (the TocBar path). */
  jumpToGroup: (groupId: string) => void;
}

export interface IntentBarHandle {
  /** Expand the body and scroll the bar into view. */
  expandAndScrollTo: () => void;
}

/** Neutral one-liner shown when the intent source is not checkable. */
const UNAVAILABLE_REASON: Record<
  Exclude<IntentCheck["specificity"], "precise">,
  string
> = {
  broad: "the ticket scope is too broad to check against this PR",
  none: "no stated intent was available for this PR",
};

/**
 * The one caution line the alarm buckets carry — epistemic, not severity.
 * Rendered ONLY when its bucket is non-empty.
 */
const ALARM_CAUTION =
  "AI-inferred tension — verify against the diff and the ticket before acting on it";

/**
 * Marks the alarm buckets. A label mark, never a color — the code-risk
 * palette here would make an epistemic caution read as a severity.
 */
const ALARM_GLYPH = "◇";

/**
 * Scheme allowlist for a model-produced `sourceUrl` before it becomes an
 * href. A non-http(s) value renders as plain text.
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The ticket-gated intent bar: a full-width instrument row beneath the capped
 * summary. The header is ALWAYS visible with neutral, symmetric bucket counts;
 * the body is collapsed by default and NEVER auto-expands — auto-open on model
 * inference is the anchoring this design exists to prevent. Broad/none sources
 * render the same quiet bar with a single unavailability line.
 */
export const IntentBar = forwardRef<IntentBarHandle, IntentBarProps>(
  function IntentBar({ intentCheck, jumpToGroup }, ref) {
    const [open, setOpen] = useState(false);
    const sectionRef = useRef<HTMLElement>(null);
    const panelId = useId();

    // Stable handle — `setOpen` and `sectionRef` are referentially fixed, so
    // the empty dep array keeps the ref identity constant across renders.
    useImperativeHandle(
      ref,
      () => ({
        expandAndScrollTo: () => {
          setOpen(true);
          sectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        },
      }),
      [],
    );

    const { specificity, ticketUrls, scopeNote } = intentCheck;
    const available = specificity === "precise";

    // Acknowledged deviations are quiet receipts, not alarms — partitioned
    // rather than sorted, because the halves carry different labels,
    // cautions, and weight.
    const unacknowledgedDeviations = intentCheck.deviations.filter(
      (item) => !item.acknowledged,
    );
    const acknowledgedDeviations = intentCheck.deviations.filter(
      (item) => item.acknowledged,
    );

    function renderItem(item: IntentItem, key: string) {
      const linked = item.sourceUrl !== "" && isHttpUrl(item.sourceUrl);
      return (
        <li className={styles["item"]} key={key}>
          {/* The jump chip IS the item's bullet; items with no carrying group
              get a plain dot so the marker column stays ruled. */}
          {item.groupIds.length > 0 ? (
            <span className={styles["jumps"]}>
              {item.groupIds.map((groupId) => (
                <button
                  className={styles["jump"]}
                  key={groupId}
                  type="button"
                  onClick={() => jumpToGroup(groupId)}
                >
                  {groupId}
                  <span aria-hidden="true" className={styles["jumpArrow"]}>
                    →
                  </span>
                </button>
              ))}
            </span>
          ) : (
            <span aria-hidden="true" className={styles["marker"]}>
              ▪
            </span>
          )}
          <span className={styles["itemBody"]}>
            <span className={styles["itemHead"]}>
              <span className={styles["intent"]}>{item.intent}</span>
              {/* Only meaningful in `deviations` — generation and the read
                  path both force it false in every other bucket. */}
              {item.acknowledged ? (
                <span className={styles["ackChip"]}>acknowledged</span>
              ) : null}
            </span>
            {/* Evidence rides one muted line beneath the claim: quote, then
                its citation after a dot — never inline with the claim. */}
            {item.quote !== "" || linked ? (
              <span className={styles["itemMeta"]}>
                {/* Text-only: model-produced quote, never markdown/HTML. */}
                {item.quote !== "" ? (
                  <q className={styles["quote"]}>{item.quote}</q>
                ) : null}
                {/* Rendered independently of the quote, so an uncited item
                    with a valid sourceUrl keeps its citation. A "" sourceUrl
                    attributes to the PR description only alongside a real
                    ticket-side quote. */}
                {linked ? (
                  <a
                    className={styles["source"]}
                    href={item.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    source
                  </a>
                ) : item.sourceUrl === "" && item.quote !== "" ? (
                  <span className={styles["source"]}>PR description</span>
                ) : null}
              </span>
            ) : null}
          </span>
        </li>
      );
    }

    /**
     * `caution` marks a bucket as alarm-class: it gets the neutral glyph on
     * its label and one muted caution line beneath it. An empty bucket is
     * omitted entirely.
     */
    function renderBucket(
      label: string,
      items: IntentItem[],
      caution?: string,
    ) {
      if (items.length === 0) return null;
      return (
        <div className={styles["bucket"]}>
          <p className={styles["bucketLabel"]}>
            {caution !== undefined ? (
              <span aria-hidden="true" className={styles["alarmGlyph"]}>
                {ALARM_GLYPH}
              </span>
            ) : null}
            {label}
          </p>
          {caution !== undefined ? (
            <p className={styles["caution"]}>{caution}</p>
          ) : null}
          <ul className={styles["bucketList"]}>
            {/* Content key: the list is immutable per prop and intent+quote
                is effectively unique within a bucket. */}
            {items.map((item) =>
              renderItem(item, `${label}::${item.intent}::${item.quote}`),
            )}
          </ul>
        </div>
      );
    }

    return (
      <section className={styles["bar"]} data-intent-bar="" ref={sectionRef}>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className={styles["toggle"]}
          type="button"
          onClick={() => setOpen((value) => !value)}
        >
          <span
            aria-hidden
            className={styles["twist"]}
            data-open={open || undefined}
          >
            ▶
          </span>
          <span className={styles["title"]}>Intent check</span>
          {available ? (
            <span className={styles["counts"]}>
              {/* Every count stays neutral and uncolored — an alarm count
                  reads exactly like the others; the register lives in the
                  body's caution lines, not here. */}
              <span className={styles["count"]}>
                {intentCheck.accomplished.length} accomplished
              </span>
              <span className={styles["count"]}>
                {intentCheck.claimedButUnachieved.length} claimed but unachieved
              </span>
              <span className={styles["count"]}>
                {intentCheck.deviations.length}{" "}
                {intentCheck.deviations.length === 1
                  ? "deviation"
                  : "deviations"}
              </span>
              <span className={styles["count"]}>
                {intentCheck.statedButMissing.length} stated but missing
              </span>
              <span className={styles["count"]}>
                {intentCheck.doneButUnstated.length} done but unstated
              </span>
              {ticketUrls.length > 0 ? (
                <span className={styles["sources"]}>
                  {ticketUrls.length} linked{" "}
                  {ticketUrls.length === 1 ? "ticket" : "tickets"}
                </span>
              ) : null}
            </span>
          ) : (
            <span className={styles["unavailable"]}>
              intent check unavailable — {UNAVAILABLE_REASON[specificity]}
            </span>
          )}
        </button>
        <div className={styles["panel"]} hidden={!open} id={panelId}>
          <ExpandableContent
            collapseLabel="Collapse intent check"
            expandLabel="Show full intent check"
            testId="intent-text"
          >
            <p className={styles["framing"]}>
              This is the AI&rsquo;s fallible read of the PR&rsquo;s stated
              intent — a factual summary of what the diff does against what the
              ticket asked, never a verdict.
            </p>
            {scopeNote !== "" ? (
              <p className={styles["scopeNote"]}>{scopeNote}</p>
            ) : null}
            {/* STATIC order — never model-ordered, never severity-sorted:
              accomplished first, alarm buckets while the reader is still
              oriented, then neutral gaps, acknowledged deviations last. */}
            {available ? (
              <>
                {renderBucket("Accomplished", intentCheck.accomplished)}
                {renderBucket(
                  "Claimed but unachieved",
                  intentCheck.claimedButUnachieved,
                  ALARM_CAUTION,
                )}
                {renderBucket(
                  "Deviations",
                  unacknowledgedDeviations,
                  ALARM_CAUTION,
                )}
                {renderBucket(
                  "Stated but missing",
                  intentCheck.statedButMissing,
                )}
                {renderBucket("Done but unstated", intentCheck.doneButUnstated)}
                {renderBucket(
                  "Deviations acknowledged in the description",
                  acknowledgedDeviations,
                )}
              </>
            ) : null}
          </ExpandableContent>
        </div>
      </section>
    );
  },
);
