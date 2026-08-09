import { useEffect, useId, useRef, useState } from "react";

import { Callout } from "@web/components/Callout/Callout";
import type { Brief } from "../../../../types";
import type { RepoConfigContext } from "../../../../utils/repoConfig";
import styles from "./BriefDetailsPanel.module.scss";

export interface BriefDetailsPanelProps {
  brief: Brief;
  /** Adjusted-line totals from the view model — the Artifact section's LOC line. */
  totalAdded: number;
  totalDeleted: number;
  /** Repo-config snapshot; absent/null → the section reports "no config". */
  repoConfig?: RepoConfigContext | null | undefined;
}

/**
 * The ⓘ Brief-details disclosure (BRIEF-103 PR 4) and its second trigger,
 * the generation-warnings count chip — co-located so ONE close path owns
 * focus return (a close that leaves keyboard focus on an unmounted portal
 * node would dump it on <body>, the exact failure the header's terminal
 * slot machinery exists to prevent).
 *
 * One anchored callout in the RiskChipDisclosure grammar — hover previews,
 * click is canonical, Escape-at-capture dismisses without reaching page
 * shortcuts (`aria-expanded` + `aria-controls` on both triggers). Carries
 * everything the old muted context line and LOC popover held: Artifact
 * identity, Generation origin (+ the BRIEF-11 warnings text the chip
 * lands on), and the repo-config surface's ok-state (that chip itself is
 * warning-only from this PR on).
 */
export function BriefDetailsPanel({
  brief,
  totalAdded,
  totalDeleted,
  repoConfig,
}: BriefDetailsPanelProps) {
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [landing, setLanding] = useState<"warnings" | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  /** Which trigger opened the current panel — the close path's focus home. */
  const openerRef = useRef<"info" | "chip" | null>(null);
  /** The mounted warnings node (portal content), for already-open landings. */
  const warningsNodeRef = useRef<HTMLDivElement | null>(null);
  const landedRef = useRef(false);

  const close = () => {
    // Focus return: if focus lives inside the portal (a chip landing put it
    // there), the unmount would drop it on <body> — send it back to the
    // trigger that opened the panel instead.
    const panelEl = document.getElementById(detailId);
    const focusWasInside = panelEl?.contains(document.activeElement) ?? false;
    setOpen(false);
    setLanding(null);
    landedRef.current = false;
    if (focusWasInside) {
      const home = openerRef.current === "chip" ? chipRef.current : triggerEl;
      home?.focus();
    }
  };

  const openPlain = () => {
    openerRef.current = "info";
    setLanding(null);
    setOpen(true);
  };

  const openOnWarnings = () => {
    openerRef.current = "chip";
    setLanding("warnings");
    setOpen(true);
    // Already open (plain or re-landing): the node is mounted, so the
    // callback ref below will never re-fire — land directly.
    const node = warningsNodeRef.current;
    if (node) {
      landedRef.current = true;
      node.focus();
    } else {
      landedRef.current = false;
    }
  };

  // The warnings-chip path lands ON the warnings text. A callback ref, not
  // an effect: Callout's FloatingPortal mounts its children one commit
  // AFTER the open flip, so an [open]-keyed effect fires before the node
  // exists. Landing happens exactly once per open (the flag re-arms on
  // close) so a re-render mid-read can't yank focus back.
  const landOnWarnings = (node: HTMLDivElement | null) => {
    warningsNodeRef.current = node;
    if (node && landing === "warnings" && !landedRef.current) {
      landedRef.current = true;
      node.focus();
    }
  };

  // Escape must dismiss a hover-opened callout too — focus may be anywhere,
  // so listen at the document while open, capture phase, and consume the
  // key so it never reaches page-level handling (focus-mode exit) — same
  // contract as RiskChipDisclosure.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // `close` is recreated per render; re-registering per render while open
    // is harmless and keeps the handler's closure fresh.
  });

  const warnings = [...new Set(brief.generationWarnings ?? [])];

  return (
    <>
      <span
        className={styles["hoverArea"]}
        onPointerEnter={(event) => {
          // Hover preview is a MOUSE affordance; touch/pen go through click
          // (touch browsers synthesize mouseenter before click — a
          // hover-open would be immediately toggled shut). Never clobber an
          // already-open panel's landing state.
          if (event.pointerType === "mouse" && !open) openPlain();
        }}
      >
        <button
          aria-controls={open ? detailId : undefined}
          aria-expanded={open}
          aria-label="Brief details"
          className={styles["trigger"]}
          data-brief-details-trigger=""
          ref={setTriggerEl}
          type="button"
          onClick={() => (open ? close() : openPlain())}
        >
          <span aria-hidden="true">i</span>
        </button>
        {open && triggerEl ? (
          <Callout anchor={triggerEl} fit onClose={close}>
            <span className={styles["panel"]} id={detailId}>
              <ArtifactSection
                brief={brief}
                totalAdded={totalAdded}
                totalDeleted={totalDeleted}
              />
              <GenerationSection brief={brief} warningsRef={landOnWarnings} />
              <RepoConfigSection repoConfig={repoConfig} />
            </span>
          </Callout>
        ) : null}
      </span>
      {warnings.length > 0 ? (
        // The generation-warnings count chip (spec: Chips): the text left
        // the header in PR 2; this chip opens the SAME panel, landed on the
        // warnings block. A landed-open chip click closes again (a button
        // announcing aria-expanded must collapse on activation).
        <button
          aria-controls={open ? detailId : undefined}
          aria-expanded={open && landing === "warnings"}
          className={`${styles["chipReset"]} ${styles["warningsChip"]}`}
          data-generation-warnings-chip=""
          ref={chipRef}
          type="button"
          onClick={() =>
            open && landing === "warnings" ? close() : openOnWarnings()
          }
        >
          <span aria-hidden="true">⚠</span>
          <span>
            {warnings.length} generation warning
            {warnings.length === 1 ? "" : "s"}
          </span>
        </button>
      ) : null}
    </>
  );
}

/** Shorten to the conventional 8-char display form; full SHAs get their own row. */
function short(sha: string): string {
  return sha.slice(0, 8);
}

function ArtifactSection({
  brief,
  totalAdded,
  totalDeleted,
}: {
  brief: Brief;
  totalAdded: number;
  totalDeleted: number;
}) {
  return (
    <section className={styles["section"]} data-details-section="artifact">
      <h2 className={styles["heading"]}>Artifact</h2>
      <dl className={styles["facts"]}>
        <dt>kind</dt>
        <dd>{brief.artifactKind}</dd>
        {brief.artifactKind === "brief" && brief.index != null ? (
          <>
            <dt>brief index</dt>
            <dd>_{brief.index}</dd>
          </>
        ) : null}
        {brief.artifactKind === "brief" && brief.commitRange ? (
          <>
            <dt>commit range</dt>
            <dd>
              {short(brief.commitRange.base)}..{short(brief.commitRange.head)} ·{" "}
              {brief.commitRange.commitCount} commit
              {brief.commitRange.commitCount === 1 ? "" : "s"}
            </dd>
            <dt>full SHAs</dt>
            <dd className={styles["shas"]}>
              {brief.commitRange.base}
              {" → "}
              {brief.commitRange.head}
            </dd>
          </>
        ) : null}
        {brief.artifactKind === "delta" &&
        brief.baselineSha &&
        brief.headSha ? (
          <>
            <dt>span</dt>
            <dd>
              {brief.baselineIndex != null
                ? `_${brief.baselineIndex}`
                : short(brief.baselineSha)}
              {" → "}
              {brief.headIndex != null
                ? `_${brief.headIndex}`
                : short(brief.headSha)}
            </dd>
            <dt>full SHAs</dt>
            <dd className={styles["shas"]}>
              {brief.baselineSha}
              {" → "}
              {brief.headSha}
            </dd>
          </>
        ) : null}
        <dt>adjusted lines</dt>
        <dd>
          <span className="green">+{totalAdded}</span>{" "}
          <span className="red">−{totalDeleted}</span>
        </dd>
      </dl>
      {/* The killed LOC popover's caveat (BRIEF-103): same words, new home. */}
      <p className={styles["caveat"]}>
        <b>Adjusted ≈ git for this local brief.</b> Move detection is not in the
        current categorizer output, so moved/generated exclusions are not
        claimed yet.
      </p>
    </section>
  );
}

function GenerationSection({
  brief,
  warningsRef,
}: {
  brief: Brief;
  warningsRef: (node: HTMLDivElement | null) => void;
}) {
  const generation = brief.generation;
  const warnings = [...new Set(brief.generationWarnings ?? [])];
  return (
    <section className={styles["section"]} data-details-section="generation">
      <h2 className={styles["heading"]}>Generation</h2>
      {generation ? (
        <dl className={styles["facts"]}>
          <dt>provider</dt>
          <dd>{generation.provider}</dd>
          <dt>model</dt>
          <dd className={styles["shas"]}>{generation.model}</dd>
          {generation.effort ? (
            <>
              <dt>effort</dt>
              <dd>{generation.effort}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className={styles["caveat"]}>
          No provenance stamp on this artifact.
        </p>
      )}
      {warnings.length > 0 ? (
        // The full BRIEF-11 text (salvage, feedback retry, served-model
        // mismatch) — the header chip's landing target, hence focusable.
        <div
          className={styles["warnings"]}
          data-details-warnings=""
          ref={warningsRef}
          role="note"
          tabIndex={-1}
        >
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RepoConfigSection({
  repoConfig,
}: {
  repoConfig: RepoConfigContext | null | undefined;
}) {
  const anyPresent =
    repoConfig != null &&
    (repoConfig.files.some((file) => file.outcome !== "absent") ||
      repoConfig.collisions.length > 0);
  return (
    <section className={styles["section"]} data-details-section="repo-config">
      <h2 className={styles["heading"]}>Repo config</h2>
      {!anyPresent ? (
        <p className={styles["caveat"]}>
          No .mergebrief configuration applied to this generation.
        </p>
      ) : (
        // Slimmed on purpose (spec): file + applied-or-not + warning line.
        // Bytes-of-budget and per-file blob SHAs stay out; the warning-state
        // chip's own callout keeps the full table.
        <ul className={styles["configList"]}>
          {repoConfig.files
            .filter((file) => file.outcome !== "absent")
            .map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span data-outcome={file.outcome}>
                  {file.outcome === "applied" ? "applied" : "not applied"}
                </span>
                {file.warning ? <i>{file.warning}</i> : null}
              </li>
            ))}
          {repoConfig.collisions.length > 0 ? (
            <li>
              <i>
                built-in wins over custom name
                {repoConfig.collisions.length === 1 ? "" : "s"}:{" "}
                {repoConfig.collisions.join(", ")}
              </i>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
