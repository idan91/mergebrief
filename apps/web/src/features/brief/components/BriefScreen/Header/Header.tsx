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
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { RiskChipDisclosure } from "../RiskChipDisclosure/RiskChipDisclosure";
import { ProviderBadge } from "./ProviderBadge/ProviderBadge";
import { StateBadge } from "./StateBadge/StateBadge";
import { TimelineNavigator } from "./TimelineNavigator/TimelineNavigator";
import styles from "./Header.module.scss";

export type ViewMode = "story" | "concerns";
export type LayoutMode = "stacked" | "split";

/**
 * Own-draft state wiring (BRIEF-43, ADR 0031): present only while the viewer
 * reads their OWN DRAFT PR. The header then labels the state with the
 * self-review chip and puts "Mark ready for review" — the state's terminal
 * action — in the slot the Receipt CTA otherwise holds.
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
   * Repo-config snapshot for this span (BRIEF-52, ADR 0032 #8): drives the
   * understated "repo config @ sha" chip with the per-file expansion;
   * absent/null (or an all-absent surface) renders no chip.
   */
  repoConfig?: RepoConfigContext | null | undefined;
  /**
   * Live webhook-maintained PR state (DB route, BRIEF-103): the state
   * badge prefers it over the artifact's stamped snapshot. Absent on the
   * local file path.
   */
  livePrState?: LivePrState | undefined;
  briefId: string;
  timeline: BriefTimeline;
  model: BriefViewModel;
  totals: ProgressTotals;
  progress: number;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  openReceipt: () => void;
  clearDrafts: () => void;
  /** Compare availability at the selected timeline point (ADR 0024). */
  availability: CompareOptionFlags;
  /** Resolved, normalized View/Compare state (ADR 0024 plan step 6). */
  compareState: BriefSearch;
  /**
   * DB-backed briefs (BRIEF-19) open the summary preview as the IN-PAGE
   * drawer via this callback: the standalone `/briefs/:id/summary-preview`
   * route loads through the local file store and cannot resolve a `db:` id.
   * Absent → the local cross-route link renders as before.
   */
  openSummaryPreviewDrawer?: (() => void) | undefined;
  /**
   * The DB route's unified revision/compare controls (BRIEF-24): rendered in
   * the local TimelineNavigator's slot so BOTH paths keep their controls in
   * the sticky header — discoverable and never scrolled out of reach.
   */
  controlsSlot?: ReactNode | undefined;
  /** Own-draft state (BRIEF-43); absent on every plain reviewer view. */
  ownDraft?: OwnDraftHeaderProps | undefined;
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
  viewMode,
  setViewMode,
  openReceipt,
  clearDrafts,
  availability,
  compareState,
  openSummaryPreviewDrawer,
  controlsSlot,
  ownDraft,
}: HeaderProps) {
  const headerRef = useRef<HTMLElement>(null);
  // The header height is content-driven (title length, meta line, viewport),
  // so publish the measured height as --top-bar-h. Sticky chunk headers and the
  // progress bar pin to that, staying flush with the header's bottom edge.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    // Write only on CHANGE: the observer fires every resize frame, and a
    // same-value setProperty still invalidates every var(--top-bar-h)
    // consumer (sticky chunk headers, the progress bar) — one source of the
    // resize stutter (Idan, 2026-08-04). Horizontal resizes rarely change
    // the height, so most frames now write nothing.
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

  // Terminal-action slot focus continuity (BRIEF-43): when the own-draft
  // state flips (either direction), the focused slot button unmounts and its
  // replacement mounts — without this, keyboard focus is dumped on <body>.
  // Track whether the slot's button holds focus (an unmounting element fires
  // no blur, so the flag survives the swap exactly when it should) and, on a
  // slot swap, move focus to the swapped-in button. The flag is CONSUMED on
  // every swap — cleared first, re-armed only by the real onFocus the
  // focus() call triggers — so a swap that happened while focus was
  // elsewhere can never leave a stale `true` behind for a LATER external
  // flip to steal focus with (review round 3).
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
    <header className={styles["header"]} ref={headerRef}>
      {/* Tier 1 — the one-line identity row (BRIEF-103): wordmark · state
          badge · title (truncates first) · repo + PR link · riders ·
          [spacer] · CTA · overflow. */}
      <div className={styles["identityRow"]}>
        {/* Lead + riders are inert on wide viewports (display: contents —
            one flex line); at ≤880px they become the two content rows of
            the grid layout, with the CTA + overflow column spanning both. */}
        <div className={styles["lead"]}>
          <div className={styles["wordmark"]}>MergeBrief</div>
          <StateBadge live={livePrState} pr={brief.pr} />
          {/* Own-draft: the self-review chip sits adjacent to the Draft badge —
              same story, told together (spec: Chips). */}
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
          <GenerationWarningsChip warnings={brief.generationWarnings} />
          {repoConfig != null ? (
            <RepoConfigChip repoConfig={repoConfig} />
          ) : null}
        </span>
        <span aria-hidden="true" className={styles["spacer"]} />
        {/* The terminal-action slot: it always holds the state's terminal
            action — Submit (→ receipt) on a reviewer view, Mark ready for
            review in the own-draft state (BRIEF-43, ADR 0031). */}
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
            {ownDraft.pending ? "Marking ready…" : "Mark ready for review"}
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
            onClick={openReceipt}
          >
            Submit
          </button>
        )}
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
          screen (revision, View/Compare, Story/Concerns), flattened to one
          wrappable line, plus the quiet stats group (BRIEF-103: moved off
          the identity row). Story/Concerns organizes content rather than
          comparison, so it parks at the far end. */}
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
        {/* The three progress facts read as ONE object — hairline-divided
            cells instead of three floating text blocks. */}
        <div className={styles["statsGroup"]}>
          <div className={`stat ${styles["stat"]}`}>
            adjusted lines
            <b>
              <span className="green">+{model.totalAdded}</span>{" "}
              <span className="faint">/</span>{" "}
              <span className="red">−{model.totalDeleted}</span>
            </b>
          </div>
          <div className={`stat ${styles["stat"]}`}>
            chunks
            <b>
              {totals.reviewed}/{totals.chunkTotal}
            </b>
          </div>
          <div className={`stat ${styles["stat"]}`}>
            flags
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
        <fieldset className={styles["viewbar"]}>
          <ScreenReaderOnly as="legend">Review view</ScreenReaderOnly>
          <label className={styles["viewOption"]}>
            <input
              checked={viewMode === "story"}
              className={styles["viewControl"]}
              name="review-view"
              type="radio"
              value="story"
              onChange={() => setViewMode("story")}
            />
            <span className={styles["viewLabel"]}>Story</span>
          </label>
          <label className={styles["viewOption"]}>
            <input
              checked={viewMode === "concerns"}
              className={styles["viewControl"]}
              name="review-view"
              type="radio"
              value="concerns"
              onChange={() => setViewMode("concerns")}
            />
            <span className={styles["viewLabel"]}>Concerns</span>
          </label>
        </fieldset>
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
 * The own-draft state label (BRIEF-43, ADR 0031): behavioral differences must
 * read as visible STATE, never as bugs — this chip is that label. It is
 * non-dismissible (no close affordance) and renders only in the own-draft
 * state. The tooltip explains what the state hides and how it ends.
 *
 * WCAG 1.4.13 (content on hover/focus): the tooltip is DISMISSABLE — while
 * it is visible (hovered OR focused, both tracked in React), a document-level
 * CAPTURE listener claims Escape and hides it, so dismissal works for a
 * hover-without-focus pointer user too, without moving the pointer or focus,
 * and the key never reaches page-level handling (focus-mode exit) — the CHIP
 * stays, only the tooltip goes. HOVERABLE — visible-state CSS re-enables
 * pointer events so the pointer can travel onto the tooltip text. PERSISTENT
 * — it stays while hovered or focused. Leaving (blur/mouse-out) re-arms it
 * for the next hover.
 */
function SelfReviewChip() {
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
      <span>Self-review — your draft</span>
      <span
        className={styles["chipInfo"]}
        data-tooltip-dismissed={tooltipDismissed ? "" : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          aria-describedby={tooltipId}
          aria-label="About self-review"
          className={styles["chipInfoButton"]}
          type="button"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          i
        </button>
        <span className={styles["chipTooltip"]} id={tooltipId} role="tooltip">
          {
            "You're viewing your own draft PR. Review submission and the receipt unlock once it's marked ready for review."
          }
        </span>
      </span>
    </span>
  );
}

interface HeaderMenuProps {
  briefId: string;
  clearDrafts: () => void;
  /** Own-draft state (BRIEF-43): the Summary preview item is submit machinery. */
  hideSummaryPreview: boolean;
  openSummaryPreviewDrawer?: (() => void) | undefined;
}

/**
 * Overflow for the header's rare actions (BRIEF-28): "Summary preview" and
 * "Clear local drafts" don't earn permanent top-level placement next to the
 * primary CTA. Standard menu-button semantics: Escape/outside-click close,
 * focus returns to the trigger, arrow keys move between items.
 */
function HeaderMenu({
  briefId,
  clearDrafts,
  hideSummaryPreview,
  openSummaryPreviewDrawer,
}: HeaderMenuProps) {
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
        aria-label="More actions"
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
          aria-label="More actions"
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
              Summary preview
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
              Summary preview
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
            Clear local drafts
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

/**
 * Generation warnings as a compact amber count chip (BRIEF-103): the prose
 * block left the header; what generation DID (salvage, feedback retry,
 * served-model mismatch — BRIEF-11) stays one disclosure away. PR 4 rewires
 * this chip to open the Brief-details panel; until then the disclosure
 * carries the prose itself so warnings never go dark between PRs.
 */
function GenerationWarningsChip({
  warnings,
}: {
  warnings: string[] | undefined;
}) {
  if (!warnings || warnings.length === 0) return null;
  const unique = [...new Set(warnings)];
  return (
    <RiskChipDisclosure
      detail={
        <span className={styles["warningsDetail"]} role="note">
          {unique.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </span>
      }
    >
      <span className={styles["warningsChip"]} data-generation-warnings-chip="">
        <span aria-hidden="true">⚠</span>
        <span>
          {unique.length} generation warning{unique.length === 1 ? "" : "s"}
        </span>
      </span>
    </RiskChipDisclosure>
  );
}

/** Error-class outcomes that flip the provenance chip to its warning state. */
const REPO_CONFIG_ERROR_OUTCOMES = new Set([
  "invalid",
  "over-budget",
  "fetch-failed",
]);

/**
 * The understated repo-config provenance chip (ADR 0032 #8): "repo config @
 * sha", expandable to the per-file outcome table; warning state on any
 * error outcome or collision — visible to author AND reviewer (the Receipt
 * carries the permanent copy). Renders nothing when every file is absent
 * and nothing collided (no `.mergebrief/` = no chip noise).
 */
function RepoConfigChip({ repoConfig }: { repoConfig: RepoConfigContext }) {
  const anyPresent =
    repoConfig.files.some((file) => file.outcome !== "absent") ||
    repoConfig.collisions.length > 0;
  if (!anyPresent) return null;
  // Warning state also on applied-with-warning files (a dropped de-emphasis
  // rule, near-cap usage): ADR 0032 #5 — "config errors surface to both
  // author and reviewer (same chip, warning state)".
  const anyError =
    repoConfig.files.some(
      (file) =>
        REPO_CONFIG_ERROR_OUTCOMES.has(file.outcome) ||
        file.warning !== undefined,
    ) || repoConfig.collisions.length > 0;
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
                  {file.bytesUsed} of {file.bytesBudget} bytes
                </span>
              ) : null}
              {file.detail ? <i>{file.detail}</i> : null}
              {file.warning ? <i>{file.warning}</i> : null}
            </span>
          ))}
          {repoConfig.collisions.length > 0 ? (
            <span className={styles["repoConfigRow"]}>
              <i>
                built-in wins over custom name
                {repoConfig.collisions.length === 1 ? "" : "s"}:{" "}
                {repoConfig.collisions.join(", ")}
              </i>
            </span>
          ) : null}
        </span>
      }
    >
      <span
        className={styles["repoConfigChip"]}
        data-repo-config-chip=""
        data-state={anyError ? "warning" : "ok"}
      >
        {anyError ? "⚠ " : ""}
        {label}
      </span>
    </RiskChipDisclosure>
  );
}
