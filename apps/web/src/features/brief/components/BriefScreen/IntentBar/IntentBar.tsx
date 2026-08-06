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
  /**
   * Expand the body and scroll the bar into view. The mark-ready soft gate
   * (BRIEF-43 modal, PR 4) calls this to land the author on the expanded
   * intent bar after closing the modal.
   */
  expandAndScrollTo: () => void;
}

/** Neutral one-liner shown when the intent corpus is not checkable. */
const UNAVAILABLE_REASON: Record<
  Exclude<IntentCheck["specificity"], "precise">,
  string
> = {
  broad: "the ticket scope is too broad to check against this PR",
  none: "no stated intent was available for this PR",
};

/**
 * The one caution line the alarm buckets carry (BRIEF-85). Deliberately
 * epistemic, not severity: these two buckets are the shakiest inference in
 * the shakiest section, so each says so in its own words rather than
 * borrowing the code-risk palette. Rendered ONLY when its bucket is
 * non-empty — a caution with nothing under it is noise.
 */
const ALARM_CAUTION =
  "AI-inferred tension — verify against the diff and the ticket before acting on it";

/**
 * Muted neutral glyph marking the two alarm buckets in the body. A label
 * mark, never a color: the design forbids the code-risk palette here (and
 * yellow specifically) so an epistemic caution can never read as a severity.
 */
const ALARM_GLYPH = "◇";

/**
 * Scheme allowlist for a model-produced `sourceUrl` before it becomes an
 * href (matches the local `isHttpUrl` pattern in validation.ts / Header.tsx —
 * there is no shared helper). A non-http(s) value renders as plain text.
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
 * The ticket-gated intent bar (BRIEF-54, ADR 0009 §2 as amended): a
 * full-width instrument row stacked with the AttributeJumpRail. The header
 * is ALWAYS visible with neutral, symmetric bucket counts (never gap-first,
 * no warning colors); the body is collapsed by default and NEVER
 * auto-expands (auto-open on model inference is the anchoring the design
 * exists to prevent). The intent check is the AI's fallible read, framed as
 * such — never a verdict. Broad/none corpora render the same quiet bar with
 * a single unavailability line.
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

    // Acknowledged deviations are quiet receipts, not alarms (the description
    // owns the reversal), so they render as their own bucket at the TAIL —
    // partitioned here rather than sorted, because the two halves carry
    // different labels, different cautions, and different weight.
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
          {/* The jump chip IS the item's bullet (owner direction, 2026-08-06):
              the marker column leads with the go-there affordance; items with
              no carrying group get a plain dot so the column stays ruled. */}
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
              {/* Only meaningful in `deviations`: generation forces it false
                  in every other bucket AND the read path re-sweeps it
                  (validation.ts), so this chip can only appear on the
                  acknowledged-deviations bucket — never inside an alarm
                  bucket under its caution. */}
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
                {/* Source is grounding, not decoration: rendered
                    independently of the quote so a warn-only uncited item
                    (empty quote but a valid sourceUrl, PR 1 quote-check is
                    warn-only) keeps its citation. A "" sourceUrl attributes
                    to the PR description only for a real ticket-side citation
                    (non-empty quote); doneButUnstated has no ticket side, so
                    it shows neither a link nor an attribution. */}
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
     * its label and one muted caution line beneath it. Both are omitted for
     * the neutral buckets, and the whole bucket is omitted when empty — so a
     * PR with no alarms renders a BODY byte-identical to the pre-BRIEF-85 bar.
     * (The header is the one deliberate exception: it grows to five counts
     * either way, per the ADR 0009 §2 amendment.)
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
            {/* Content key: the item list is immutable per prop, and
                intent+quote is effectively unique within a bucket — no array
                index (react rules). */}
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
              {/* Five counts now, and every one stays neutral and uncolored —
                  the header lock holds (BRIEF-54: never gap-first, no warning
                  colors). An alarm count reads exactly like the others; the
                  register lives in the body's caution lines, not here. */}
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
            testId="intent-prose"
          >
            <p className={styles["framing"]}>
              This is the AI&rsquo;s fallible read of the PR&rsquo;s stated
              intent — a factual summary of what the diff does against what the
              ticket asked, never a verdict.
            </p>
            {scopeNote !== "" ? (
              <p className={styles["scopeNote"]}>{scopeNote}</p>
            ) : null}
            {/* STATIC order, locked by the grill — never model-ordered and never
              severity-sorted: accomplished first (the PR's own story), the two
              alarm buckets next while the reader is still oriented, then the
              neutral gaps, with acknowledged deviations last as quiet
              receipts. */}
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
