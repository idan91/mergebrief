import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState } from "react";

import { Callout } from "@web/components/Callout";
import { Chip } from "@web/components/Chip";
import { IconButton } from "@web/components/IconButton";
import { LocSign, LocSigns } from "@web/components/LocSign";
import type { Brief } from "../../../../types";
import type { RepoConfigContext } from "../../../../utils/repoConfig";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import styles from "./BriefDetailsPanel.module.scss";

export interface BriefDetailsPanelProps {
  brief: Brief;
  /** Adjusted-line totals from the view model, the Artifact section's LOC line. */
  totalAdded: number;
  totalDeleted: number;
  /** Core-chunk derived-line totals from the view model. */
  totalCoreAdded: number;
  totalCoreDeleted: number;
  /** Repo-config snapshot; absent/null → the section reports "no config". */
  repoConfig?: RepoConfigContext | null | undefined;
}

/**
 * The ⓘ Brief-details disclosure and its second trigger, the
 * generation-warnings count chip, co-located so ONE close path owns focus
 * return; a close that leaves keyboard focus on an unmounted portal node
 * would dump it on <body>.
 *
 * One anchored callout in the RiskChipDisclosure grammar: hover previews,
 * click is canonical, Escape-at-capture dismisses without reaching page
 * shortcuts.
 */
export function BriefDetailsPanel({
  brief,
  totalAdded,
  totalDeleted,
  totalCoreAdded,
  totalCoreDeleted,
  repoConfig,
}: BriefDetailsPanelProps) {
  const { t } = useTranslation();
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [landing, setLanding] = useState<"warnings" | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  /** Which trigger opened the current panel, the close path's focus home. */
  const openerRef = useRef<"info" | "chip" | null>(null);
  /** The mounted warnings node (portal content), for already-open landings. */
  const warningsNodeRef = useRef<HTMLDivElement | null>(null);
  const landedRef = useRef(false);

  const close = () => {
    // Focus return: if focus lives inside the portal (a chip landing put it
    // there), the unmount would drop it on <body>, so send it back to the
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
    // callback ref below will never re-fire, so land directly.
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

  // Escape must dismiss a hover-opened callout too, and focus may be anywhere,
  // so listen at the document while open, capture phase, and consume the key
  // so it never reaches page-level handling.
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
          // (touch browsers synthesize mouseenter before click, so a
          // hover-open would be immediately toggled shut). Never clobber an
          // already-open panel's landing state.
          if (event.pointerType === "mouse" && !open) openPlain();
        }}
      >
        <IconButton
          aria-controls={open ? detailId : undefined}
          aria-expanded={open}
          className={styles["trigger"]}
          data-brief-details-trigger=""
          label={t("brief.details.ariaLabelTrigger")}
          ref={setTriggerEl}
          onClick={() => (open ? close() : openPlain())}
        >
          <span aria-hidden="true">i</span>
        </IconButton>
        {open && triggerEl ? (
          <Callout anchor={triggerEl} fit onClose={close}>
            <span className={styles["panel"]} id={detailId}>
              <ArtifactSection
                brief={brief}
                totalAdded={totalAdded}
                totalDeleted={totalDeleted}
                totalCoreAdded={totalCoreAdded}
                totalCoreDeleted={totalCoreDeleted}
              />
              <GenerationSection brief={brief} warningsRef={landOnWarnings} />
              <RepoConfigSection repoConfig={repoConfig} />
            </span>
          </Callout>
        ) : null}
      </span>
      {warnings.length > 0 ? (
        // Opens the SAME panel, landed on the warnings block. A landed-open
        // chip click closes again: a button announcing aria-expanded must
        // collapse on activation.
        <Chip
          aria-controls={open ? detailId : undefined}
          aria-expanded={open && landing === "warnings"}
          className={styles["warningsChip"]}
          data-generation-warnings-chip=""
          ref={chipRef}
          tone="warning"
          onClick={() =>
            open && landing === "warnings" ? close() : openOnWarnings()
          }
        >
          <Icon name={IconNames.WARNING} size={IconSizes.SM} />
          <span>{t("brief.details.warnings", { count: warnings.length })}</span>
        </Chip>
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
  totalCoreAdded,
  totalCoreDeleted,
}: {
  brief: Brief;
  totalAdded: number;
  totalDeleted: number;
  totalCoreAdded: number;
  totalCoreDeleted: number;
}) {
  const { t } = useTranslation();
  const hasBaselineIndex =
    brief.baselineIndex !== null && brief.baselineIndex !== undefined;
  const hasHeadIndex =
    brief.headIndex !== null && brief.headIndex !== undefined;
  return (
    <section className={styles["section"]} data-details-section="artifact">
      <h2 className={styles["heading"]}>
        {t("brief.details.artifactHeading")}
      </h2>
      <dl className={styles["facts"]}>
        <dt>{t("brief.details.kind")}</dt>
        <dd>{brief.artifactKind}</dd>
        {brief.artifactKind === "brief" && brief.index !== undefined ? (
          <>
            <dt>{t("brief.details.briefIndex")}</dt>
            <dd>_{brief.index}</dd>
          </>
        ) : null}
        {brief.artifactKind === "brief" && brief.commitRange ? (
          <>
            <dt>{t("brief.details.commitRange")}</dt>
            <dd>
              {short(brief.commitRange.base)}..{short(brief.commitRange.head)} ·{" "}
              {t("brief.details.commits", {
                count: brief.commitRange.commitCount,
              })}
            </dd>
            <dt>{t("brief.details.fullShas")}</dt>
            <dd className={styles["shas"]}>
              {brief.commitRange.base}{" "}
              <Icon
                name={IconNames.ARROW_UP}
                rotation={IconRotations.QUARTER}
                size={IconSizes.SM}
              />{" "}
              {brief.commitRange.head}
            </dd>
          </>
        ) : null}
        {brief.artifactKind === "delta" &&
        brief.baselineSha &&
        brief.headSha ? (
          <>
            <dt>{t("brief.details.span")}</dt>
            <dd>
              {hasBaselineIndex
                ? `_${brief.baselineIndex}`
                : short(brief.baselineSha)}{" "}
              <Icon
                name={IconNames.ARROW_UP}
                rotation={IconRotations.QUARTER}
                size={IconSizes.SM}
              />{" "}
              {hasHeadIndex ? `_${brief.headIndex}` : short(brief.headSha)}
            </dd>
            <dt>{t("brief.details.fullShas")}</dt>
            <dd className={styles["shas"]}>
              {brief.baselineSha}{" "}
              <Icon
                name={IconNames.ARROW_UP}
                rotation={IconRotations.QUARTER}
                size={IconSizes.SM}
              />{" "}
              {brief.headSha}
            </dd>
          </>
        ) : null}
        <dt>{t("brief.details.changedLines")}</dt>
        <dd>
          <LocSign sign={LocSigns.ADD} count={totalAdded} />{" "}
          <LocSign sign={LocSigns.DEL} count={totalDeleted} />
        </dd>
        <dt>{t("brief.details.coreLines")}</dt>
        <dd>
          <LocSign sign={LocSigns.ADD} count={totalCoreAdded} />{" "}
          <LocSign sign={LocSigns.DEL} count={totalCoreDeleted} />
        </dd>
      </dl>
      <p className={styles["caveat"]}>
        <b>{t("brief.details.countsCaveatLead")}</b>{" "}
        {t("brief.details.countsCaveatBody")}
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
  const { t } = useTranslation();
  const generation = brief.generation;
  const warnings = [...new Set(brief.generationWarnings ?? [])];
  return (
    <section className={styles["section"]} data-details-section="generation">
      <h2 className={styles["heading"]}>
        {t("brief.details.generationHeading")}
      </h2>
      {generation ? (
        <dl className={styles["facts"]}>
          <dt>{t("brief.details.provider")}</dt>
          <dd>{generation.provider}</dd>
          <dt>{t("brief.details.model")}</dt>
          <dd className={styles["shas"]}>{generation.model}</dd>
          {generation.effort ? (
            <>
              <dt>{t("brief.details.effort")}</dt>
              <dd>{generation.effort}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className={styles["caveat"]}>{t("brief.details.noOriginStamp")}</p>
      )}
      {warnings.length > 0 ? (
        // The header chip's landing target, hence focusable.
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
  const { t } = useTranslation();
  const anyPresent =
    repoConfig !== null &&
    repoConfig !== undefined &&
    (repoConfig.files.some((file) => file.outcome !== "absent") ||
      repoConfig.collisions.length > 0);
  return (
    <section className={styles["section"]} data-details-section="repo-config">
      <h2 className={styles["heading"]}>
        {t("brief.details.repoConfigHeading")}
      </h2>
      {!anyPresent ? (
        <p className={styles["caveat"]}>{t("brief.details.noRepoConfig")}</p>
      ) : (
        // Slimmed on purpose: bytes-of-budget and per-file blob SHAs stay
        // out; the warning-state chip's own callout keeps the full table.
        <ul className={styles["configList"]}>
          {repoConfig.files
            .filter((file) => file.outcome !== "absent")
            .map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span data-outcome={file.outcome}>
                  {file.outcome === "applied"
                    ? t("brief.details.applied")
                    : t("brief.details.notApplied")}
                </span>
                {file.warning ? <i>{file.warning}</i> : null}
              </li>
            ))}
          {repoConfig.collisions.length > 0 ? (
            <li>
              <i>
                {t("brief.details.collisionsLine", {
                  count: repoConfig.collisions.length,
                  names: repoConfig.collisions.join(", "),
                })}
              </i>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
