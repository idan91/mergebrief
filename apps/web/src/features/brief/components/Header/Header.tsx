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

import type { BriefSearch, CompareOptionFlags } from "../../compareState";
import type { ProgressTotals } from "../../progress";
import type { BriefTimeline } from "../../timeline";
import type { Brief } from "../../types";
import type { BriefViewModel } from "../../viewModel";
import { TimelineNavigator } from "../TimelineNavigator/TimelineNavigator";
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
  briefId: string;
  timeline: BriefTimeline;
  model: BriefViewModel;
  totals: ProgressTotals;
  progress: number;
  locOpen: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  setLocOpen: (value: boolean) => void;
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
  briefId,
  timeline,
  model,
  totals,
  progress,
  locOpen,
  viewMode,
  setViewMode,
  setLocOpen,
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
    const apply = () =>
      document.documentElement.style.setProperty(
        "--top-bar-h",
        `${el.offsetHeight}px`,
      );
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
    "--progress-width": `${progress}%`,
  };
  const prLink = isHttpUrl(brief.pr.url) ? brief.pr.url : null;
  const meta = briefMetaLine(brief);

  return (
    <header className={styles["header"]} ref={headerRef}>
      {/* Tier 1 — identity and status: stable while reviewing. */}
      <div className={styles["identityRow"]}>
        <div className={styles["wordmark"]}>
          MergeBrief<span> / review</span>
        </div>
        <div className={styles["prmeta"]}>
          <h1 className={styles["title"]}>{brief.pr.title}</h1>
          {/* One truncating context line: identity facts read left to right in
              falling order of stability (repo → PR → artifact → provenance). */}
          <div className={styles["sub"]}>
            <b>{brief.pr.repo}</b> ·{" "}
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
            )}{" "}
            · {artifactHeaderLabel(brief)}
            {meta ? ` · ${meta}` : ""}
          </div>
          {brief.generationWarnings && brief.generationWarnings.length > 0 ? (
            // What generation DID, not just that it finished (BRIEF-11):
            // salvage, feedback retry, and served-model mismatch stay
            // visible on the artifact they degraded.
            <div className={styles["generationWarnings"]} role="note">
              {[...new Set(brief.generationWarnings)].map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}
        </div>
        {/* The three progress facts read as ONE object — hairline-divided
            cells instead of three floating text blocks. */}
        <div className={styles["statsGroup"]}>
          <button
            className={`stat ${styles["stat"]} ${styles["locBadge"]}`}
            data-state={locOpen ? "open" : "closed"}
            type="button"
            onClick={() => setLocOpen(!locOpen)}
          >
            <span>adjusted lines</span>
            <b>
              <span className="green">+{model.totalAdded}</span>{" "}
              <span className="faint">/</span>{" "}
              <span className="red">−{model.totalDeleted}</span>
            </b>
            <span className={styles["locPop"]}>
              <b>Adjusted ≈ git for this local brief.</b>
              <br />
              Move detection is not in the current categorizer output, so
              moved/generated exclusions are not claimed yet.
            </span>
          </button>
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
        {ownDraft !== undefined ? <SelfReviewChip /> : null}
        {/* The terminal-action slot: it always holds the state's terminal
            action — Receipt (→ submit) on a reviewer view, Mark ready for
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
            Receipt
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
          wrappable line. Story/Concerns organizes content rather than
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
        <fieldset className={styles["viewbar"]}>
          <legend className="sr-only">Review view</legend>
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
  "--progress-width": string;
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

function artifactHeaderLabel(brief: Brief): string {
  if (brief.artifactKind === "delta" && brief.baselineSha && brief.headSha) {
    return `local delta ${brief.baselineSha.slice(0, 7)} → ${brief.headSha.slice(0, 7)}`;
  }
  return `local brief @ ${brief.pr.sha.slice(0, 7)}`;
}

/** Muted index/commit-range + generation provenance, when present (ADR 0012/0013). */
function briefMetaLine(brief: Brief): string {
  const parts: string[] = [];
  if (brief.artifactKind === "brief" && brief.index != null) {
    const range = brief.commitRange
      ? ` · ${brief.commitRange.base.slice(0, 8)}..${brief.commitRange.head.slice(0, 8)}, ${brief.commitRange.commitCount} commit${brief.commitRange.commitCount === 1 ? "" : "s"}`
      : "";
    parts.push(`brief _${brief.index}${range}`);
  } else if (
    brief.artifactKind === "delta" &&
    (brief.baselineIndex != null || brief.headIndex != null)
  ) {
    const b =
      brief.baselineIndex != null
        ? `_${brief.baselineIndex}`
        : (brief.baselineSha?.slice(0, 8) ?? "?");
    const h =
      brief.headIndex != null
        ? `_${brief.headIndex}`
        : (brief.headSha?.slice(0, 8) ?? "?");
    parts.push(`${b} → ${h}`);
  }
  if (brief.generation) {
    const g = brief.generation;
    // Own-property only: the provider token comes from artifact data, and a
    // plain index read would resolve inherited Object members ("toString").
    const adapterClass = Object.hasOwn(PROVIDER_CLASS_LABEL, g.provider)
      ? PROVIDER_CLASS_LABEL[g.provider]
      : undefined;
    parts.push(
      `via ${g.provider}${adapterClass ? ` (${adapterClass})` : ""}/${g.model}${g.effort ? ` · effort ${g.effort}` : ""}`,
    );
  }
  return parts.join(" · ");
}

/**
 * Adapter CLASS per provider token (BRIEF-11 / ADR 0030 #6): a harness-CLI
 * run must be visibly distinct from an API/SDK run — the CLI owns routing
 * and auth, so "claude-code" and "anthropic" are different trust shapes
 * even when the same model served. Pinned to `Providers` in
 * packages/generators/src/registry.ts (kept as plain data here — the
 * header is client code and must not pull provider SDKs into the bundle).
 */
const PROVIDER_CLASS_LABEL: Record<string, string> = {
  anthropic: "API",
  openai: "API",
  openrouter: "API",
  "claude-code": "local CLI",
  codex: "local CLI",
};
