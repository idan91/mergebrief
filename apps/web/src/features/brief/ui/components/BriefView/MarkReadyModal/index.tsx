// The mark-ready soft gate: it gates the ready-for-review handoff, not a
// review submit.
//
// Contract: lists ALL risk flags on the current head's Brief (no
// read-tracking filter: the author confronts the full surface, not the
// unread remainder); the unposted-drafts reminder line rides the modal only
// (N>0), with a jump link and NO auto-post; "Mark ready anyway" is one click
// and records nothing. The zero-flag bypass lives in the caller: the modal
// shows iff flags exist.
import { useTranslation } from "react-i18next";
import { Button } from "@web/components/Button";
import { LinkButton } from "@web/components/LinkButton";
import { RowButton } from "@web/components/RowButton";
import { Modal } from "@web/components/Modal";
import type { RiskFlag } from "@web/features/brief/model/utils/viewModel";
import styles from "@web/components/Modal/Modal.module.scss";

export interface MarkReadyModalProps {
  open: boolean;
  /** ALL risk flags on the current head's Brief, never pre-filtered. */
  flags: RiskFlag[];
  unpostedDraftCount: number;
  close: () => void;
  /**
   * The confirm action. Runs the mark-ready mutation directly when the
   * post-drafts checkbox is unchecked; when checked (N>0), the caller posts
   * every unposted draft first and only then marks ready.
   */
  markReadyAnyway: () => void;
  jumpToFlag: (flag: RiskFlag) => void;
  /** Lands on the first unposted draft comment; posting stays manual. */
  jumpToDrafts: () => void;
  /**
   * Opt-in batch post. Controlled by the caller so it can default UNCHECKED
   * each time the gate opens (posting is an outward write). Only rendered
   * when N>0.
   */
  postDrafts?: boolean;
  setPostDrafts?: (value: boolean) => void;
  /**
   * Set while the batch runs (e.g. "Posting 2 of 3…"): the confirm button
   * shows it and every control disables so a second batch cannot start.
   */
  busyLabel?: string | undefined;
  /**
   * The count of precise stated-but-missing intent asks. Rendered as ONE
   * count-only secondary line when > 0, never gap-first, and never part of
   * the gate's OPEN condition (gaps alone never open the modal). Absent/zero
   * → no line (absence, not a green verdict).
   */
  intentGapCount?: number;
  /**
   * The count of precise intent TENSIONS: unacknowledged deviations plus
   * claimed-but-unachieved. A second count-only line on the same terms as the
   * gap line, sharing its jump target. Acknowledged deviations are excluded
   * by the caller.
   */
  intentTensionCount?: number;
  /** Close the modal and jump to the expanded intent bar. */
  jumpToIntentGaps?: () => void;
}

export function MarkReadyModal({
  open,
  flags,
  unpostedDraftCount,
  close,
  markReadyAnyway,
  jumpToFlag,
  jumpToDrafts,
  postDrafts = false,
  setPostDrafts,
  busyLabel,
  intentGapCount = 0,
  intentTensionCount = 0,
  jumpToIntentGaps,
}: MarkReadyModalProps) {
  const { t } = useTranslation();
  const busy = busyLabel !== undefined;
  const draftLabel = t("pulls.markReadyModal.postDrafts", {
    count: unpostedDraftCount,
  });
  return (
    // Escape is gated on busy exactly like the buttons: dismissing the gate
    // mid-batch would drop the progress feedback while outward writes
    // continue. An absent close makes Escape a no-op.
    <Modal
      open={open}
      boxClassName={styles["wideBox"]}
      close={busy ? undefined : close}
      labelledBy="mark-ready-modal-heading"
    >
      <h2 id="mark-ready-modal-heading">{t("pulls.markReadyModal.heading")}</h2>
      {/* Zero flags: the gate can open for unposted drafts alone; no
          risk-flag copy over an empty list; the advisory line focuses on the
          drafts instead. */}
      {flags.length > 0 ? (
        <>
          <p className={styles["copy"]}>
            {t("pulls.markReadyModal.advisoryFlags")}
          </p>
          <div className={styles["unresolvedList"]}>
            {flags.map((flag) => (
              <RowButton
                disabled={busy}
                key={flag.id}
                variant="card"
                onClick={() => jumpToFlag(flag)}
              >
                <span
                  data-deemphasized={flag.deEmphasized ? "" : undefined}
                  data-source={flag.source}
                >
                  {flag.attr}
                </span>
                <b>{flag.file}</b>
                {flag.source === "repo-policy" || flag.deEmphasized ? (
                  <i data-kind="risk-caption">
                    {[
                      ...(flag.source === "repo-policy"
                        ? [
                            flag.implication
                              ? t(
                                  "pulls.markReadyModal.flagPolicyImplication",
                                  {
                                    implication: flag.implication,
                                  },
                                )
                              : t("pulls.markReadyModal.flagPolicy"),
                          ]
                        : []),
                      ...(flag.deEmphasized
                        ? [t("pulls.markReadyModal.flagDeEmphasized")]
                        : []),
                    ].join(" · ")}
                  </i>
                ) : null}
              </RowButton>
            ))}
          </div>
        </>
      ) : (
        <p className={styles["copy"]}>
          {t("pulls.markReadyModal.advisoryDrafts")}
        </p>
      )}
      {/* Count-only intent line: a factual count below the flags list, never
          gap-first, only when the intent source is precise and asks are
          missing (the caller gates it). */}
      {intentGapCount > 0 ? (
        <p className={styles["copy"]}>
          <LinkButton disabled={busy} onClick={jumpToIntentGaps}>
            {t("pulls.markReadyModal.statedAsks", { count: intentGapCount })}
          </LinkButton>
        </p>
      ) : null}
      {/* Second count-only line, same register and jump target as the gap
          line. Count only: naming which ask is in tension here would anchor
          the author on the shakiest inference in the Brief at exactly the
          moment they are deciding. */}
      {intentTensionCount > 0 ? (
        <p className={styles["copy"]}>
          <LinkButton disabled={busy} onClick={jumpToIntentGaps}>
            {t("pulls.markReadyModal.intentTensions", {
              count: intentTensionCount,
            })}
          </LinkButton>
        </p>
      ) : null}
      {unpostedDraftCount > 0 ? (
        <>
          <p className={styles["copy"]}>
            <span>
              {t("pulls.markReadyModal.unpostedDrafts", {
                count: unpostedDraftCount,
              })}
            </span>{" "}
            <LinkButton disabled={busy} onClick={jumpToDrafts}>
              {t("pulls.markReadyModal.jumpToDrafts")}
            </LinkButton>
          </p>
          <label className={styles["postDraftsToggle"]}>
            <input
              type="checkbox"
              checked={postDrafts}
              disabled={busy}
              onChange={(event) => setPostDrafts?.(event.target.checked)}
            />
            <span>{draftLabel}</span>
          </label>
        </>
      ) : null}
      <div className={styles["actions"]}>
        <Button disabled={busy} onClick={close}>
          {t("pulls.markReadyModal.keepReviewing")}
        </Button>
        {/* disabled+loading while the batch runs (aria-only, focus survives):
            the "Posting N of M…" relabel stays announced inside the modal's
            trap; the live region below speaks the progress. */}
        <Button
          disabled={busy}
          loading={busy}
          variant="accent"
          onClick={markReadyAnyway}
        >
          {busyLabel ?? t("pulls.markReadyModal.markReadyAnyway")}
        </Button>
      </div>
      {/* Batch progress for screen readers: the confirm button's visual
          relabel is silent to AT, so each step is announced politely here. */}
      <span
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {busyLabel ?? ""}
      </span>
    </Modal>
  );
}
