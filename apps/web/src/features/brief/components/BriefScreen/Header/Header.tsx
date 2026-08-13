import { LocalePicker } from "../../../../../i18n/LocalePicker/LocalePicker";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type {
  BriefSearch,
  CompareOptionFlags,
} from "../../../comparison/compareState";
import type { ProgressTotals } from "../../../utils/progress";
import type { BriefTimeline } from "../../../utils/timeline";
import type { RepoConfigContext } from "../../../utils/repoConfig";
import type { Brief, LivePrState } from "../../../types";
import type { BriefViewModel } from "../../../utils/viewModel";
import type { LensControlState, ViewMode } from "../modeLegality";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { CoreLinesDisclosure } from "../CoreLinesDisclosure/CoreLinesDisclosure";
import { RiskChipDisclosure } from "../RiskChipDisclosure/RiskChipDisclosure";
import { BriefDetailsPanel } from "./BriefDetailsPanel/BriefDetailsPanel";
import { ProviderBadge } from "./ProviderBadge/ProviderBadge";
import { StateBadge } from "./StateBadge/StateBadge";
import { TimelineNavigator } from "./TimelineNavigator/TimelineNavigator";
import styles from "./Header.module.scss";

export type { ViewMode } from "../modeLegality";
export type LayoutMode = "stacked" | "split";

/**
 * Present only while the viewer reads their OWN DRAFT PR: the header labels
 * the state with the self-review chip and puts "Mark ready for review" in the
 * slot the Receipt CTA otherwise holds.
 */
export interface OwnDraftHeaderProps {
  /** The state's terminal action (opens the soft gate or marks ready directly). */
  markReady: () => void;
  /** True while the mark-ready mutation (incl. the pr-view refresh) is in flight. */
  pending: boolean;
  /**
   * True while a historical revision is in view: mark-ready is head-scoped,
   * so the CTA reads disabled (still focusable) and the click announces why.
   */
  unavailable?: boolean;
}

export interface HeaderProps {
  brief: Brief;
  /**
   * Drives the "repo config @ sha" chip; absent/null (or an all-absent
   * surface) renders no chip.
   */
  repoConfig?: RepoConfigContext | null | undefined;
  /**
   * Live webhook-maintained PR state (DB route): the state badge prefers it
   * over the artifact's stamped snapshot. Absent on the local file path.
   */
  livePrState?: LivePrState | undefined;
  briefId: string;
  timeline: BriefTimeline;
  model: BriefViewModel;
  totals: ProgressTotals;
  progress: number;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /**
   * `disabled` greys the Story/Concerns control — aria-disabled + no-op,
   * never hard `disabled` (that dumps keyboard focus) — and carries the
   * honest reason, never a silent override.
   */
  lensControl: LensControlState;
  /** Voices the disabled lens reason on an attempted switch. */
  announce: (message: string) => void;
  openSubmit: () => void;
  clearDrafts: () => void;
  /** Compare availability at the selected timeline point. */
  availability: CompareOptionFlags;
  /** Resolved, normalized View/Compare state. */
  compareState: BriefSearch;
  /**
   * DB-backed briefs open the summary preview as the IN-PAGE drawer via this
   * callback: the standalone `/briefs/:id/summary-preview` route loads through
   * the local file store and cannot resolve a `db:` id.
   * Absent → the local cross-route link renders as before.
   */
  openSummaryPreviewDrawer?: (() => void) | undefined;
  /**
   * The DB route's unified revision/compare controls: rendered in the local
   * TimelineNavigator's slot so BOTH paths keep their controls in the sticky
   * header — discoverable and never scrolled out of reach.
   */
  controlsSlot?: ReactNode | undefined;
  /** Own-draft state; absent on every plain reviewer view. */
  ownDraft?: OwnDraftHeaderProps | undefined;
  /**
   * A revision load outlasted the pending delay: a small spinner rides next
   * to the revision controls. Decorative — the content region's `aria-busy`
   * carries the semantics.
   */
  revisionPending?: boolean | undefined;
}

// The product name — an identifier, never translated.
const PRODUCT_NAME = "MergeBrief";

export function Header({
  brief,
  repoConfig,
  livePrState,
  briefId,
  timeline,
  model,
  totals,
  progress,
  viewMode,
  setViewMode,
  lensControl,
  announce,
  openSubmit,
  clearDrafts,
  availability,
  compareState,
  openSummaryPreviewDrawer,
  controlsSlot,
  ownDraft,
  revisionPending,
}: HeaderProps) {
  const { t } = useTranslation();
  const headerRef = useRef<HTMLElement>(null);
  // The header height is content-driven (title length, meta line, viewport),
  // so publish the measured height as --top-bar-h. Sticky chunk headers and the
  // progress bar pin to that, staying flush with the header's bottom edge.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    // Write only on CHANGE: the observer fires every resize frame, and a
    // same-value setProperty still invalidates every var(--top-bar-h)
    // consumer, which stutters the resize.
    let lastHeight = "";
    const apply = () => {
      const next = `${el.offsetHeight}px`;
      if (next === lastHeight) return;
      lastHeight = next;
      document.documentElement.style.setProperty("--top-bar-h", next);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Terminal-action slot focus continuity: when the own-draft state flips,
  // the focused slot button unmounts and its replacement mounts — without
  // this, keyboard focus is dumped on <body>. An unmounting element fires no
  // blur, so the flag survives the swap. It is CONSUMED on every swap —
  // cleared first, re-armed only by the real onFocus the focus() call
  // triggers — so a swap while focus was elsewhere leaves no stale `true`
  // for a later flip to steal focus with.
  const terminalSlotRef = useRef<HTMLButtonElement>(null);
  const terminalSlotFocused = useRef(false);
  const wasOwnDraft = useRef(ownDraft !== undefined);
  useEffect(() => {
    const isOwnDraftNow = ownDraft !== undefined;
    if (wasOwnDraft.current !== isOwnDraftNow) {
      const slotHadFocus = terminalSlotFocused.current;
      terminalSlotFocused.current = false;
      if (slotHadFocus) {
        terminalSlotRef.current?.focus();
      }
    }
    wasOwnDraft.current = isOwnDraftNow;
  }, [ownDraft]);

  const progressStyle: ProgressBarStyle = {
    "--progress-scale": `${progress / 100}`,
  };
  const prLink = isHttpUrl(brief.pr.url) ? brief.pr.url : null;

  // A disabled control keeps its radios focusable and operable — the change
  // handler no-ops and announces the reason instead (controlled inputs snap
  // back on the same render).
  const lensDisabled = lensControl.state === "disabled";
  const lensReasonId = useId();
  const selectLens = (mode: ViewMode) => {
    if (lensControl.state === "disabled") {
      announce(lensControl.reason);
      return;
    }
    setViewMode(mode);
  };

  return (
    <header className={styles["header"]} ref={headerRef}>
      {/* Tier 1 — the one-line identity row: wordmark · state badge · title
          (truncates first) · repo + PR link · riders · [spacer] · CTA ·
          overflow. */}
      <div className={styles["identityRow"]}>
        {/* Lead + riders are inert on wide viewports (display: contents —
            one flex line); at ≤880px they become the two content rows of
            the grid layout, with the CTA + overflow column spanning both. */}
        <div className={styles["lead"]}>
          <div className={styles["wordmark"]}>{PRODUCT_NAME}</div>
          <StateBadge live={livePrState} pr={brief.pr} />
          {/* The self-review chip must stay adjacent to the Draft badge. */}
          {ownDraft !== undefined ? <SelfReviewChip /> : null}
          <h1 className={styles["title"]}>{brief.pr.title}</h1>
          <span className={styles["repoRef"]}>
            <b>{brief.pr.repo}</b>{" "}
            {prLink ? (
              <a
                className={styles["ghlink"]}
                href={prLink}
                target="_blank"
                rel="noreferrer"
              >
                #{brief.pr.number} ↗
              </a>
            ) : (
              <span>#{brief.pr.number}</span>
            )}
          </span>
        </div>
        {/* Everything after the repo/PR link wraps to a second line on
            narrow viewports; the CTA + overflow stay pinned at the row end. */}
        <span className={styles["riders"]}>
          <ProviderBadge generation={brief.generation} />
          {/* The ⓘ disclosure AND the generation-warnings chip (its second
              trigger) — co-located inside so one close path owns focus. */}
          <BriefDetailsPanel
            brief={brief}
            repoConfig={repoConfig}
            totalAdded={model.totalAdded}
            totalDeleted={model.totalDeleted}
            totalCoreAdded={model.totalCoreAdded}
            totalCoreDeleted={model.totalCoreDeleted}
          />
          {repoConfig != null ? (
            <RepoConfigChip repoConfig={repoConfig} />
          ) : null}
        </span>
        <span aria-hidden="true" className={styles["spacer"]} />
        {/* The terminal-action slot: Submit on a reviewer view, Mark ready for
            review in the own-draft state. */}
        {ownDraft !== undefined ? (
          /* aria-disabled, never hard disabled, while pending: a disabled
             element dumps keyboard focus on <body>; the click path is safe
             regardless — the mark-ready flow's in-flight guard no-ops
             repeats. */
          <button
            aria-disabled={ownDraft.pending || ownDraft.unavailable === true}
            className="btn primary"
            data-terminal-slot=""
            ref={terminalSlotRef}
            type="button"
            onBlur={() => {
              terminalSlotFocused.current = false;
            }}
            onFocus={() => {
              terminalSlotFocused.current = true;
            }}
            onClick={ownDraft.markReady}
          >
            {ownDraft.pending
              ? t("brief.header.markingReady")
              : t("brief.header.markReady")}
          </button>
        ) : (
          <button
            className="btn primary"
            data-terminal-slot=""
            ref={terminalSlotRef}
            type="button"
            onBlur={() => {
              terminalSlotFocused.current = false;
            }}
            onFocus={() => {
              terminalSlotFocused.current = true;
            }}
            onClick={openSubmit}
          >
            {t("brief.header.submitReviewCta")}
          </button>
        )}
        <LocalePicker />
        <HeaderMenu
          briefId={briefId}
          clearDrafts={clearDrafts}
          /* Summary preview is submit machinery (review outcome + summary):
             hidden-not-broken in the own-draft state. */
          hideSummaryPreview={ownDraft !== undefined}
          openSummaryPreviewDrawer={openSummaryPreviewDrawer}
        />
      </div>
      {/* Tier 2 — the lens toolbar: everything that changes WHAT is on
          screen, flattened to one wrappable line, plus the quiet stats group.
          Story/Concerns organizes content rather than comparison, so it parks
          at the far end. */}
      <div className={styles["lensRow"]}>
        {controlsSlot !== undefined ? (
          controlsSlot
        ) : (
          <TimelineNavigator
            availability={availability}
            briefId={briefId}
            compareState={compareState}
            timeline={timeline}
          />
        )}
        {revisionPending === true ? (
          <span aria-hidden="true" className={styles["revisionSpinner"]} />
        ) : null}
        {/* The three progress facts read as ONE object — hairline-divided
            cells instead of three floating text blocks. */}
        <div className={styles["detailsRegion"]}>
          <div className={styles["statsGroup"]}>
            <CoreLinesDisclosure
              allAdded={model.totalAdded}
              allDeleted={model.totalDeleted}
              coreAdded={model.totalCoreAdded}
              coreDeleted={model.totalCoreDeleted}
              triggerClassName={`stat ${styles["stat"]}`}
            >
              {t("brief.header.coreLines")}
              <b>
                <span aria-hidden="true" className="faint">
                  {"≈ "}
                </span>
                <ScreenReaderOnly>
                  {t("brief.header.approximately")}
                </ScreenReaderOnly>
                <span className="green">+{model.totalCoreAdded}</span>{" "}
                <span className="faint">/</span>{" "}
                <span className="red">−{model.totalCoreDeleted}</span>
              </b>
            </CoreLinesDisclosure>
            <div className={`stat ${styles["stat"]}`}>
              {t("brief.header.chunks")}
              <b>
                {totals.reviewed}/{totals.chunkTotal}
              </b>
            </div>
            <div className={`stat ${styles["stat"]}`}>
              {t("brief.header.flags")}
              {/* Own-draft state: dispositions are unreachable (flags are a
                read-only mirror), so a resolved/total fraction would sit at a
                permanent 0/N — show the count alone. */}
              {ownDraft !== undefined ? (
                <b>{totals.flagTotal}</b>
              ) : (
                <b>
                  {totals.flagsResolved}/{totals.flagTotal}
                </b>
              )}
            </div>
          </div>
          <fieldset
            className={styles["viewbar"]}
            data-state={lensDisabled ? "disabled" : undefined}
            title={lensDisabled ? lensControl.reason : undefined}
          >
            <ScreenReaderOnly as="legend">
              {t("brief.header.viewLegend")}
            </ScreenReaderOnly>
            <label className={styles["viewOption"]}>
              <input
                aria-describedby={lensDisabled ? lensReasonId : undefined}
                aria-disabled={lensDisabled || undefined}
                checked={viewMode === "story"}
                className={styles["viewControl"]}
                name="review-view"
                type="radio"
                value="story"
                onChange={() => selectLens("story")}
              />
              <span className={styles["viewLabel"]}>
                {t("brief.header.viewStory")}
              </span>
            </label>
            <label className={styles["viewOption"]}>
              <input
                aria-describedby={lensDisabled ? lensReasonId : undefined}
                aria-disabled={lensDisabled || undefined}
                checked={viewMode === "concerns"}
                className={styles["viewControl"]}
                name="review-view"
                type="radio"
                value="concerns"
                onChange={() => selectLens("concerns")}
              />
              <span className={styles["viewLabel"]}>
                {t("brief.header.viewConcerns")}
              </span>
            </label>
            {lensDisabled ? (
              <span className="sr-only" id={lensReasonId}>
                {lensControl.reason}
              </span>
            ) : null}
          </fieldset>
        </div>
      </div>
      {/* Decorative twin of the stats' numbers — hidden from the tree. */}
      <div
        aria-hidden="true"
        className={styles["progressBar"]}
        style={progressStyle}
      />
    </header>
  );
}

/**
 * The own-draft state label: non-dismissible (no close affordance), rendered
 * only in the own-draft state.
 *
 * WCAG 1.4.13 (content on hover/focus): the tooltip is DISMISSABLE — while
 * visible (hovered OR focused, both tracked in React), a document-level
 * CAPTURE listener claims Escape and hides only the tooltip, so a
 * hover-without-focus pointer user can dismiss it without moving the pointer,
 * and the key never reaches page-level handling. HOVERABLE — visible-state
 * CSS re-enables pointer events so the pointer can travel onto the tooltip.
 * PERSISTENT — it stays while hovered or focused; leaving re-arms it.
 */
function SelfReviewChip() {
  const { t } = useTranslation();
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);
  // The Escape claim exists exactly while the tooltip is visible: capture
  // phase on document beats (and stops) the window-level page-shortcut
  // listener, and detaches the moment the tooltip is gone so a plain Escape
  // elsewhere on the page is untouched.
  const tooltipVisible = (hovered || focused) && !tooltipDismissed;
  useEffect(() => {
    if (!tooltipVisible) return;
    // `globalThis.`: the module imports React's KeyboardEvent for the menu;
    // this is a native document listener.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setTooltipDismissed(true);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [tooltipVisible]);
  // Re-arm only when BOTH channels are idle: with hover and focus
  // overlapping, a per-channel re-arm (on mouseleave / on blur) would bring a
  // dismissed tooltip back while the OTHER channel still holds it visible —
  // Escape must stick for as long as either channel is active.
  useEffect(() => {
    if (!hovered && !focused) setTooltipDismissed(false);
  }, [focused, hovered]);
  return (
    <span className={styles["selfReviewChip"]} data-self-review-chip="">
      <span>{t("brief.header.selfReviewChip")}</span>
      <span
        className={styles["chipInfo"]}
        data-tooltip-dismissed={tooltipDismissed ? "" : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          aria-describedby={tooltipId}
          aria-label={t("brief.header.ariaLabelAboutSelfReview")}
          className={styles["chipInfoButton"]}
          type="button"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          i
        </button>
        <span className={styles["chipTooltip"]} id={tooltipId} role="tooltip">
          {t("brief.header.selfReviewTooltip")}
        </span>
      </span>
    </span>
  );
}

interface HeaderMenuProps {
  briefId: string;
  clearDrafts: () => void;
  /** Summary preview is submit machinery, hidden in the own-draft state. */
  hideSummaryPreview: boolean;
  openSummaryPreviewDrawer?: (() => void) | undefined;
}

/**
 * Overflow for the header's rare actions. Standard menu-button semantics:
 * Escape/outside-click close, focus returns to the trigger, arrow keys move
 * between items.
 */
function HeaderMenu({
  briefId,
  clearDrafts,
  hideSummaryPreview,
  openSummaryPreviewDrawer,
}: HeaderMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Focus the first item when the menu opens (menu-button pattern).
  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !wrapRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const closeAndRefocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // On the wrapper, not the popup: Escape must also work when focus sits on
  // the trigger with the menu open, and it must never leak to the page-level
  // shortcut listener (which binds Escape to exiting focus mode).
  const onWrapKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    event.stopPropagation();
    if (event.key === "Escape") {
      closeAndRefocus();
      return;
    }
    // APG menu-button: Tab closes the menu and moves focus onward — from
    // the trigger, not from a menuitem the close is about to unmount (which
    // would drop focus to <body> and restart tabbing at the document top).
    if (event.key === "Tab") {
      triggerRef.current?.focus();
      setOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const active = document.activeElement;
    const current = active instanceof HTMLElement ? items.indexOf(active) : -1;
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  };

  // No blur-based closer: Safari/Firefox-macOS don't focus buttons on
  // mousedown, so a click on a menuitem blurs the focused item first — a
  // blur handler would unmount the menu before the click lands. The
  // pointerdown-outside listener, Tab, and Escape cover every close path.

  return (
    // Coordination wrapper, not an interactive element itself: the handler
    // only closes/steers the menu; the interactive semantics live on the
    // trigger and the menuitems inside.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles["menuWrap"]} ref={wrapRef} onKeyDown={onWrapKeyDown}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("brief.header.ariaLabelMoreActions")}
        className={styles["menuTrigger"]}
        ref={triggerRef}
        type="button"
        // Close via the refocus helper: WebKit/Firefox-macOS don't focus a
        // clicked button, so a plain toggle would unmount the focused
        // menuitem and drop focus to <body>.
        onClick={() => (open ? closeAndRefocus() : setOpen(true))}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div
          className={styles["menu"]}
          id={menuId}
          role="menu"
          aria-label={t("brief.header.ariaLabelMoreActions")}
          tabIndex={-1}
        >
          {hideSummaryPreview ? null : openSummaryPreviewDrawer ===
            undefined ? (
            <Link
              className={styles["menuItem"]}
              params={{ briefId }}
              role="menuitem"
              tabIndex={0}
              to="/briefs/$briefId/summary-preview"
              onClick={() => setOpen(false)}
              // Anchors activate on Enter only; menuitem promises Space too.
              onKeyDown={(event) => {
                if (event.key === " ") {
                  event.preventDefault();
                  event.currentTarget.click();
                }
              }}
            >
              {t("brief.header.summaryPreview")}
            </Link>
          ) : (
            <button
              className={styles["menuItem"]}
              role="menuitem"
              type="button"
              onClick={() => {
                // The drawer never claims focus, so return it to the
                // trigger — otherwise the unmounting menuitem drops it
                // on <body>.
                closeAndRefocus();
                openSummaryPreviewDrawer();
              }}
            >
              {t("brief.header.summaryPreview")}
            </button>
          )}
          <button
            className={styles["menuItem"]}
            role="menuitem"
            type="button"
            onClick={() => {
              closeAndRefocus();
              clearDrafts();
            }}
          >
            {t("brief.header.clearDrafts")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface ProgressBarStyle extends CSSProperties {
  "--progress-scale": string;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Error-class outcomes that flip the origin chip to its warning state. */
const REPO_CONFIG_ERROR_OUTCOMES = new Set([
  "invalid",
  "over-budget",
  "fetch-failed",
]);

/**
 * The repo-config origin chip, WARNING-ONLY: the ok-state lives in the
 * Brief-details panel, so the chip renders only when something needs the
 * author's or reviewer's attention (error outcome, applied-with-warning, or
 * a collision).
 */
function RepoConfigChip({ repoConfig }: { repoConfig: RepoConfigContext }) {
  const { t } = useTranslation();
  const anyPresent =
    repoConfig.files.some((file) => file.outcome !== "absent") ||
    repoConfig.collisions.length > 0;
  if (!anyPresent) return null;
  // Warning state also on applied-with-warning files: config problems must
  // surface to author and reviewer alike.
  const anyError =
    repoConfig.files.some(
      (file) =>
        REPO_CONFIG_ERROR_OUTCOMES.has(file.outcome) ||
        file.warning !== undefined,
    ) || repoConfig.collisions.length > 0;
  if (!anyError) return null;
  const appliedSha = repoConfig.files.find(
    (file) => file.outcome === "applied" && file.blobSha !== null,
  )?.blobSha;
  const label = appliedSha
    ? `repo config @ ${appliedSha.slice(0, 7)}`
    : "repo config";
  return (
    <RiskChipDisclosure
      detail={
        <span className={styles["repoConfigTable"]}>
          {repoConfig.files.map((file) => (
            <span className={styles["repoConfigRow"]} key={file.path}>
              <code>{file.path}</code>
              <span data-outcome={file.outcome}>{file.outcome}</span>
              {file.blobSha ? <code>@ {file.blobSha.slice(0, 7)}</code> : null}
              {file.bytesUsed !== undefined &&
              file.bytesBudget !== undefined ? (
                <span>
                  {t("brief.details.bytesUsed", {
                    used: file.bytesUsed,
                    budget: file.bytesBudget,
                  })}
                </span>
              ) : null}
              {file.detail ? <i>{file.detail}</i> : null}
              {file.warning ? <i>{file.warning}</i> : null}
            </span>
          ))}
          {repoConfig.collisions.length > 0 ? (
            <span className={styles["repoConfigRow"]}>
              <i>
                {t("brief.details.collisionsLine", {
                  count: repoConfig.collisions.length,
                  names: repoConfig.collisions.join(", "),
                })}
              </i>
            </span>
          ) : null}
        </span>
      }
    >
      <span
        className={styles["repoConfigChip"]}
        data-repo-config-chip=""
        data-state="warning"
      >
        {"⚠ "}
        {label}
      </span>
    </RiskChipDisclosure>
  );
}
