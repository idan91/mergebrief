// The mark-ready soft gate (BRIEF-43; ADR 0009 #3 realized per ADR 0031).
// PreSubmitModal's SHAPE, reused deliberately — same Modal primitive (focus
// management, Escape, reduced-motion), same content stylesheet, same
// advisory/list/actions structure — but a separate concern: it gates the
// ready-for-review handoff, not a review submit.
//
// Contract (locked): lists ALL risk flags on the current head's Brief (no
// read-tracking filter — the author confronts the full surface, not the
// unread remainder); the unposted-drafts reminder line rides the modal only
// (N>0), with a jump link and NO auto-post; "Mark ready anyway" is one click
// and records nothing. The zero-flag bypass lives in the caller: the modal
// shows iff flags exist.
import { Modal } from "../../../../components/Modal/Modal";
import type { RiskFlag } from "../../../brief/viewModel";
import styles from "../../../review/components/ModalContent.module.scss";

export interface MarkReadyModalProps {
  open: boolean;
  /** ALL risk flags on the current head's Brief — never pre-filtered. */
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
   * Opt-in batch post (BRIEF-43 follow-up): "post my drafts before marking
   * ready". Controlled by the caller so it can default UNCHECKED each time the
   * gate opens (posting is an outward write). Only rendered when N>0.
   */
  postDrafts?: boolean;
  setPostDrafts?: (value: boolean) => void;
  /**
   * Set while the batch runs (e.g. "Posting 2 of 3…"): the confirm button
   * shows it and every control disables so a second batch cannot start.
   */
  busyLabel?: string | undefined;
  /**
   * BRIEF-54 soft-gate line: the count of precise stated-but-missing intent
   * asks. Rendered as ONE count-only secondary line only when > 0 — never
   * gap-first, and the fallible intent signal never drives the gate's OPEN
   * condition (the caller's render gate ignores it, so gaps alone never open
   * the modal). Absent/zero → no line (absence, not a green verdict).
   */
  intentGapCount?: number;
  /** Close the modal and jump to the expanded intent bar (PR 3 handle). */
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
  jumpToIntentGaps,
}: MarkReadyModalProps) {
  const busy = busyLabel !== undefined;
  const draftLabel = `Post my ${String(unpostedDraftCount)} draft comment${unpostedDraftCount === 1 ? "" : "s"} before marking ready`;
  return (
    // Escape is gated on busy exactly like the buttons (reviewer round 1 #2):
    // dismissing the gate mid-batch would drop the progress feedback while
    // outward writes continue. An absent close makes Escape a no-op.
    <Modal
      open={open}
      boxClassName={styles["wideBox"]}
      close={busy ? undefined : close}
    >
      <h3>Before marking ready</h3>
      {/* Zero flags (owner amendment): the gate can open for unposted drafts
          alone — no risk-flag copy over an empty list; the advisory line
          focuses on the drafts instead. */}
      {flags.length > 0 ? (
        <>
          <p className={styles["copy"]}>
            This is advisory. These risk flags are on the current brief — fix
            and push (the brief regenerates and flags drop), or mark ready
            as-is.
          </p>
          <div className={styles["unresolvedList"]}>
            {flags.map((flag) => (
              <button
                className={styles["unresolvedItem"]}
                key={flag.id}
                type="button"
                disabled={busy}
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
                            `defined by repo policy${flag.implication ? ` — ${flag.implication}` : ""}`,
                          ]
                        : []),
                      ...(flag.deEmphasized
                        ? ["de-emphasized by repo policy"]
                        : []),
                    ].join(" · ")}
                  </i>
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className={styles["copy"]}>
          This is advisory. Your unposted draft comments stay local unless
          posted — post them first, or mark ready as-is.
        </p>
      )}
      {/* BRIEF-54 count-only intent line: a quiet secondary affordance below
          the flags list — factual count, never gap-first, only when the
          intent source is precise and asks are missing (the caller gates it).
          Click closes the modal and lands on the expanded intent bar. */}
      {intentGapCount > 0 ? (
        <p className={styles["copy"]}>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={jumpToIntentGaps}
          >
            {`${String(intentGapCount)} stated ask${intentGapCount === 1 ? "" : "s"} not found in the diff`}
          </button>
        </p>
      ) : null}
      {unpostedDraftCount > 0 ? (
        <>
          <p className={styles["copy"]}>
            <span>
              {`You have ${String(unpostedDraftCount)} unposted draft comment${unpostedDraftCount === 1 ? "" : "s"}.`}
            </span>{" "}
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={jumpToDrafts}
            >
              Jump to your drafts
            </button>
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
        <button className="btn" type="button" disabled={busy} onClick={close}>
          Keep self-reviewing
        </button>
        {/* aria-disabled (never hard disabled) while the batch runs: a
            disabled element dumps keyboard focus on <body> inside the modal's
            trap, and the "Posting N of M…" relabel would go unannounced. The
            click stays a no-op via the busy guard; the live region below
            speaks the progress. */}
        <button
          aria-busy={busy || undefined}
          aria-disabled={busy}
          className="btn primary"
          type="button"
          onClick={busy ? undefined : markReadyAnyway}
        >
          {busyLabel ?? "Mark ready anyway"}
        </button>
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
