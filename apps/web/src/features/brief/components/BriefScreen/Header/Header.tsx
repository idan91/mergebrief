import { LocalePicker } from "../../../../../i18n/LocalePicker/LocalePicker";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { CONTENT_START_ATTR } from "../utils";
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
import { isDbBriefId } from "../../../utils/briefIdentity";
import type { BriefViewModel } from "../../../utils/viewModel";
import { AccessibleLink } from "@web/components/AccessibleLink/AccessibleLink";
import { Button } from "@web/components/Button/Button";
import { IconButton } from "@web/components/IconButton/IconButton";
import { CoreLinesDisclosure } from "../CoreLinesDisclosure/CoreLinesDisclosure";
import { UnattributedDisclosure } from "../UnattributedDisclosure/UnattributedDisclosure";
import { RiskChipDisclosure } from "../RiskChipDisclosure/RiskChipDisclosure";
import { BriefDetailsPanel } from "./BriefDetailsPanel/BriefDetailsPanel";
import { ProviderBadge } from "./ProviderBadge/ProviderBadge";
import { StateBadge } from "./StateBadge/StateBadge";
import { TimelineNavigator } from "./TimelineNavigator/TimelineNavigator";
import styles from "./Header.module.scss";

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
  openSubmit: () => void;
  /** Compare availability at the selected timeline point. */
  availability: CompareOptionFlags;
  /** Resolved, normalized View/Compare state. */
  compareState: BriefSearch;
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

/** Longer than the collapse ease, so the height is read once settled. */
const SETTLE_MS = 200;

/** --sticky-stack-h is @property-registered, so this reads a number, not
 * the calc() text an unregistered custom property returns. */
function readStickyStackHeight(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    "--sticky-stack-h",
  );
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function Header({
  brief,
  repoConfig,
  livePrState,
  briefId,
  timeline,
  model,
  totals,
  progress,
  openSubmit,
  availability,
  compareState,
  controlsSlot,
  ownDraft,
  revisionPending,
}: HeaderProps) {
  const { t } = useTranslation();
  const headerRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Written at the flip, not by an effect: the observer's callback runs
  // before paint, so a passive effect would still read the pre-flip value.
  const collapsedRef = useRef(false);
  // The whole pinned stack at rest, not just the header — content must clear
  // the toolbar too. At rest only, or trigger and result chase each other.
  const [restHeight, setRestHeight] = useState(0);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    // Write only on CHANGE: the observer fires every resize frame, and a
    // same-value setProperty still invalidates every var(--top-bar-h)
    // consumer, which stutters the resize.
    let lastHeight = "";
    let settle = 0;
    const apply = () => {
      const next = `${el.offsetHeight}px`;
      if (next === lastHeight) return;
      lastHeight = next;
      document.documentElement.style.setProperty("--top-bar-h", next);
      if (collapsedRef.current) return;
      // On settle, not per frame: the ease resizes ~10 times, and each read
      // would resolve style synchronously and rebuild the observer.
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        setRestHeight(readStickyStackHeight());
      }, SETTLE_MS);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      window.clearTimeout(settle);
      observer.disconnect();
    };
  }, []);

  // Fires on the crossing alone; a scroll-driven timeline samples geometry
  // every frame, measured at ~7ms extra p95 frame gap.
  useEffect(() => {
    const sentinel = document.querySelector(`[${CONTENT_START_ATTR}]`);
    if (!sentinel || restHeight === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Last entry is current: a jump can batch a down-then-up crossing.
        const entry = entries.at(-1);
        if (!entry) return;
        // rootBounds is null cross-origin; that edge is the same line.
        const line = entry.rootBounds?.top ?? restHeight;
        const next = entry.boundingClientRect.top <= line;
        collapsedRef.current = next;
        setCollapsed(next);
      },
      // Margining by the RESTING height leaves the rest-minus-collapsed
      // difference as hysteresis, so a crossing cannot flap against itself.
      { rootMargin: `-${restHeight}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [restHeight]);

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

  return (
    <header
      className={styles["header"]}
      ref={headerRef}
      data-collapsed={collapsed ? "" : undefined}
    >
      {/* Tier 1 — the identity row: wordmark · title block · [spacer] · CTA ·
          overflow. The block is two lines: the SOURCE (title, state, repo, PR
          link), then how the brief was GENERATED (model, details, warnings). */}
      <div className={styles["identityRow"]}>
        {/* Lead is inert on wide viewports (display: contents — one flex
            line); at ≤880px it becomes the grid's content row, with the CTA +
            overflow column beside it. */}
        <div className={styles["lead"]}>
          <div className={styles["wordmark"]}>{PRODUCT_NAME}</div>
          <div className={styles["titleBlock"]}>
            <div className={styles["titleLine"]}>
              <h1 className={styles["title"]}>{brief.pr.title}</h1>
              <StateBadge live={livePrState} pr={brief.pr} />
              {/* The self-review chip must stay adjacent to the Draft badge. */}
              {ownDraft !== undefined ? <SelfReviewChip /> : null}
              <span className={styles["repoRef"]}>
                <b>{brief.pr.repo}</b>{" "}
                {prLink ? (
                  <AccessibleLink
                    className={styles["ghlink"]}
                    href={prLink}
                    target="_blank"
                  >
                    #{brief.pr.number} ↗
                  </AccessibleLink>
                ) : (
                  <span>#{brief.pr.number}</span>
                )}
              </span>
            </div>
            {/* How the brief was GENERATED. Its source — title, state, repo and
                PR link — stays on the line above. Never wraps above 880px: a
                second wrap would put the block at three lines at rest and two
                collapsed, which moves the published --top-bar-h mid-scroll. */}
            <span className={styles["metaLine"]}>
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
          </div>
        </div>
        <span aria-hidden="true" className={styles["spacer"]} />
        {/* The terminal-action slot: Submit on a reviewer view, Mark ready for
            review in the own-draft state. */}
        {ownDraft !== undefined ? (
          /* Caller-owned aria-disabled (not the `disabled` prop): the click
             stays live so an unavailable/pending press ANNOUNCES its reason —
             the mark-ready flow's in-flight guard no-ops repeats. */
          <Button
            aria-busy={ownDraft.pending || undefined}
            aria-disabled={ownDraft.pending || ownDraft.unavailable === true}
            data-terminal-slot=""
            ref={terminalSlotRef}
            variant="primary"
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
          </Button>
        ) : (
          <Button
            data-terminal-slot=""
            ref={terminalSlotRef}
            variant="primary"
            onBlur={() => {
              terminalSlotFocused.current = false;
            }}
            onFocus={() => {
              terminalSlotFocused.current = true;
            }}
            onClick={openSubmit}
          >
            {t("brief.header.submitReviewCta")}
          </Button>
        )}
        <LocalePicker />
        <HeaderMenu
          briefId={briefId}
          /* Summary preview is submit machinery (review outcome + summary):
             hidden-not-broken in the own-draft state. */
          hideSummaryPreview={ownDraft !== undefined}
        />
      </div>
      {/* Tier 2 — the lens toolbar: everything that changes WHAT is on
          screen (Scope, Compare), flattened to one wrappable line, plus the
          quiet stats group parked at the far end. */}
      <div className={styles["lensRow"]}>
        {controlsSlot !== undefined ? (
          <div className={styles["lensCluster"]}>{controlsSlot}</div>
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
                <span className="green">+{model.totalCoreAdded}</span>{" "}
                <span className="faint">/</span>{" "}
                <span className="red">−{model.totalCoreDeleted}</span>
              </b>
            </CoreLinesDisclosure>
            {model.unattributed !== undefined &&
            model.unattributed.added + model.unattributed.deleted > 0 ? (
              <UnattributedDisclosure
                totalChanged={model.totalAdded + model.totalDeleted}
                triggerClassName={`stat ${styles["stat"]}`}
                view={model.unattributed}
              />
            ) : null}
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
        {/* eslint-disable-next-line no-restricted-syntax -- tooltip anchor (cursor: help, no onClick): not an action */}
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
  /** Summary preview is submit machinery, hidden in the own-draft state. */
  hideSummaryPreview: boolean;
}

/**
 * Overflow for the header's rare actions. Standard menu-button semantics:
 * Escape/outside-click close, focus returns to the trigger, arrow keys move
 * between items.
 */
function HeaderMenu({ briefId, hideSummaryPreview }: HeaderMenuProps) {
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

  // Summary preview is the menu's only entry: with it hidden there is nothing
  // to overflow, so the trigger goes too rather than opening an empty popup.
  // (Local briefs only — the standalone preview route resolves through the
  // local file store, and DB briefs get their receipt in the submit flow.)
  if (hideSummaryPreview || isDbBriefId(briefId)) return null;

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
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles["menuWrap"]} ref={wrapRef} onKeyDown={onWrapKeyDown}>
      <IconButton
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        className={styles["menuTrigger"]}
        label={t("brief.header.ariaLabelMoreActions")}
        ref={triggerRef}
        size="lg"
        variant="outlined"
        // Close via the refocus helper: WebKit/Firefox-macOS don't focus a
        // clicked button, so a plain toggle would unmount the focused
        // menuitem and drop focus to <body>.
        onClick={() => (open ? closeAndRefocus() : setOpen(true))}
      >
        <span aria-hidden="true">⋯</span>
      </IconButton>
      {open ? (
        <div
          className={styles["menu"]}
          id={menuId}
          role="menu"
          aria-label={t("brief.header.ariaLabelMoreActions")}
          tabIndex={-1}
        >
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
