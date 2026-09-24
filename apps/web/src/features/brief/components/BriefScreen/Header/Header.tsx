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
import {
  GroupViewKinds,
  type BriefViewModel,
  type UnattributedRemainderGroupView,
} from "../../../utils/viewModel";
import { AccessibleLink } from "@web/components/AccessibleLink/AccessibleLink";
import { PRODUCT_NAME } from "@web/components/Header/consts";
import { AccountMenu } from "@web/features/account";
import { Button } from "@web/components/Button/Button";
import { IconButton } from "@web/components/IconButton/IconButton";
import { LocSign, LocSigns } from "@web/components/LocSign/LocSign";
import { CoreLinesDisclosure } from "../CoreLinesDisclosure/CoreLinesDisclosure";
import { UnattributedDisclosure } from "../UnattributedDisclosure/UnattributedDisclosure";
import { RiskChipDisclosure } from "../RiskChipDisclosure/RiskChipDisclosure";
import { BranchPair } from "./BranchPair/BranchPair";
import { BriefDetailsPanel } from "./BriefDetailsPanel/BriefDetailsPanel";
import { ProviderBadge } from "./ProviderBadge/ProviderBadge";
import { StackChip } from "./StackChip/StackChip";
import { resolveStackView } from "./StackChip/utils";
import { StateBadge } from "./StateBadge/StateBadge";
import { SubmitReviewCta } from "./SubmitReviewCta/SubmitReviewCta";
import { TimelineNavigator } from "./TimelineNavigator/TimelineNavigator";
import { Icon } from "@web/components/Icon/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./Header.module.scss";

export interface OwnDraftHeaderProps {
  markReady: () => void;
  pending: boolean;
  unavailable?: boolean;
}

export interface HeaderProps {
  brief: Brief;
  repoConfig?: RepoConfigContext | null | undefined;
  livePrState?: LivePrState | undefined;
  briefId: string;
  repoId?: string | undefined;
  timeline: BriefTimeline;
  model: BriefViewModel;
  totals: ProgressTotals;
  progress: number;
  openSubmit: () => void;
  draftCommentCount: number;
  availability: CompareOptionFlags;
  compareState: BriefSearch;
  /**
   * The DB route's unified revision/compare controls: rendered in the local
   * TimelineNavigator's slot so BOTH paths keep their controls in the sticky
   * header, discoverable and never scrolled out of reach.
   */
  controlsSlot?: ReactNode | undefined;
  ownDraft?: OwnDraftHeaderProps | undefined;
  revisionPending?: boolean | undefined;
  jumpToGroup: (groupId: string) => void;
  jumpToGroupHeading: (groupId: string) => void;
  /** The Account menu's Keyboard shortcuts row opens the shortcuts modal. */
  toggleShortcuts: () => void;
}

const SETTLE_MS = 200;

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
  repoId,
  timeline,
  model,
  totals,
  progress,
  openSubmit,
  draftCommentCount,
  availability,
  compareState,
  controlsSlot,
  ownDraft,
  revisionPending,
  jumpToGroup,
  jumpToGroupHeading,
  toggleShortcuts,
}: HeaderProps) {
  const { t } = useTranslation();
  const stackView = resolveStackView(brief.pr.stack, livePrState?.stack);
  const headerRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  // The whole pinned stack at rest, not just the header, content must clear
  // the toolbar too. At rest only, or trigger and result chase each other.
  const [restHeight, setRestHeight] = useState(0);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    let lastHeight = "";
    let settle = 0;
    const apply = () => {
      const next = `${el.offsetHeight}px`;
      if (next === lastHeight) return;
      lastHeight = next;
      document.documentElement.style.setProperty("--top-bar-h", next);
      if (collapsedRef.current) return;
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

  useEffect(() => {
    const sentinel = document.querySelector(`[${CONTENT_START_ATTR}]`);
    if (!sentinel || restHeight === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (!entry) return;
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
  const hasRepoConfig = repoConfig !== null && repoConfig !== undefined;
  const remainderGroup = model.groups.find(
    (group): group is UnattributedRemainderGroupView =>
      group.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER,
  );

  return (
    <header
      className={styles["header"]}
      ref={headerRef}
      data-collapsed={collapsed ? "" : undefined}
    >
      <div className={styles["identityRow"]}>
        {/* Lead is inert on wide viewports (display: contents, one flex
            line); at ≤880px it becomes the grid's content row, with the CTA +
            overflow column beside it. */}
        <div className={styles["lead"]}>
          <AccessibleLink className={styles["wordmark"]} href="/">
            {PRODUCT_NAME}
          </AccessibleLink>
          <div className={styles["titleBlock"]}>
            <div className={styles["titleLine"]}>
              <h1 className={styles["title"]}>{brief.pr.title}</h1>
              <StateBadge live={livePrState} pr={brief.pr} />
              {ownDraft !== undefined ? <SelfReviewChip /> : null}
              <span className={styles["repoRef"]}>
                <b>{brief.pr.repo}</b>{" "}
                {prLink ? (
                  <AccessibleLink
                    className={styles["ghlink"]}
                    href={prLink}
                    target="_blank"
                  >
                    #{brief.pr.number}{" "}
                    <Icon name={IconNames.ARROW_UP_RIGHT} size={IconSizes.SM} />
                  </AccessibleLink>
                ) : (
                  <span>#{brief.pr.number}</span>
                )}
              </span>
            </div>
            {/* PR identity (stack, branches) left; how the brief was
                GENERATED (provider, details, repo-config) after. Never wraps
                above 880px: a second wrap would put the block at three lines
                at rest and two collapsed, which moves --top-bar-h mid-scroll. */}
            <span className={styles["metaLine"]}>
              {stackView !== undefined ? (
                <StackChip
                  currentNumber={brief.pr.number}
                  prUrl={brief.pr.url}
                  repoId={repoId}
                  snapshot={stackView.snapshot}
                  stack={stackView.stack}
                />
              ) : null}
              <BranchPair
                baseRef={brief.pr.baseRef}
                headRef={brief.pr.headRef}
              />
              <ProviderBadge generation={brief.generation} />
              <BriefDetailsPanel
                brief={brief}
                repoConfig={repoConfig}
                totalAdded={model.totalAdded}
                totalDeleted={model.totalDeleted}
                totalCoreAdded={model.totalCoreAdded}
                totalCoreDeleted={model.totalCoreDeleted}
              />
              {hasRepoConfig ? (
                <RepoConfigChip repoConfig={repoConfig} />
              ) : null}
            </span>
          </div>
        </div>
        <span aria-hidden="true" className={styles["spacer"]} />
        {ownDraft !== undefined ? (
          /* Caller-owned aria-disabled (not the `disabled` prop): the click
             stays live so an unavailable/pending press ANNOUNCES its reason,
             the mark-ready flow's in-flight guard no-ops repeats. */
          <Button
            aria-busy={ownDraft.pending || undefined}
            aria-disabled={ownDraft.pending || ownDraft.unavailable === true}
            data-terminal-slot=""
            ref={terminalSlotRef}
            variant="accent"
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
          <SubmitReviewCta
            count={draftCommentCount}
            slotRef={terminalSlotRef}
            onBlur={() => {
              terminalSlotFocused.current = false;
            }}
            onClick={openSubmit}
            onFocus={() => {
              terminalSlotFocused.current = true;
            }}
          />
        )}
        <HeaderMenu
          briefId={briefId}
          hideSummaryPreview={ownDraft !== undefined}
        />
        <AccountMenu onOpenShortcuts={toggleShortcuts} />
      </div>
      {/* Tier 2, the lens toolbar: everything that changes WHAT is on
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
                <LocSign sign={LocSigns.ADD} count={model.totalCoreAdded} />{" "}
                <span className="faint">/</span>{" "}
                <LocSign sign={LocSigns.DEL} count={model.totalCoreDeleted} />
              </b>
            </CoreLinesDisclosure>
            {remainderGroup !== undefined ? (
              <UnattributedDisclosure
                group={remainderGroup}
                jumpToGroup={jumpToGroup}
                jumpToGroupHeading={jumpToGroupHeading}
                triggerClassName={`stat ${styles["stat"]}`}
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
      <div
        aria-hidden="true"
        className={styles["progressBar"]}
        style={progressStyle}
      />
    </header>
  );
}

/**
 * The own-draft state label, non-dismissible and own-draft only. WCAG 1.4.13:
 * DISMISSABLE through a capture-phase Escape that hides only the tooltip, so a
 * hovering pointer user need not move and the key never reaches page handling;
 * HOVERABLE via visible-state pointer events; PERSISTENT while hovered or focused.
 */
function SelfReviewChip() {
  const { t } = useTranslation();
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);
  const tooltipVisible = (hovered || focused) && !tooltipDismissed;
  useEffect(() => {
    if (!tooltipVisible) return;
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
  // dismissed tooltip back while the OTHER channel still holds it visible,
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
        {/* oxlint-disable-next-line house/no-raw-button -- tooltip anchor (cursor: help, no onClick): not an action */}
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
  hideSummaryPreview: boolean;
}

function HeaderMenu({ briefId, hideSummaryPreview }: HeaderMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

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
  // mousedown, so a click on a menuitem blurs the focused item first, a
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
        // Close via the refocus helper: WebKit/Firefox-macOS don't focus a
        // clicked button, so a plain toggle would unmount the focused
        // menuitem and drop focus to <body>.
        onClick={() => (open ? closeAndRefocus() : setOpen(true))}
      >
        <Icon name={IconNames.DOTS_THREE} size={IconSizes.MD} />
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

const REPO_CONFIG_ERROR_OUTCOMES = new Set([
  "invalid",
  "over-budget",
  "fetch-failed",
]);

function RepoConfigChip({ repoConfig }: { repoConfig: RepoConfigContext }) {
  const { t } = useTranslation();
  const anyPresent =
    repoConfig.files.some((file) => file.outcome !== "absent") ||
    repoConfig.collisions.length > 0;
  if (!anyPresent) return null;
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
    ? t("brief.header.repoConfigChipAt", { sha: appliedSha.slice(0, 7) })
    : t("brief.header.repoConfigChip");
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
        <Icon name={IconNames.WARNING} size={IconSizes.SM} />
        {label}
      </span>
    </RiskChipDisclosure>
  );
}
