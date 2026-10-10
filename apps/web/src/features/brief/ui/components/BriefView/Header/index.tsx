import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { CONTENT_START_ATTR } from "../utils";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type {
  BriefSearch,
  CompareOptionFlags,
} from "../../../../model/comparison/compare-state";
import type { ProgressTotals } from "../../../utils/progress";
import type { RepoConfigContext } from "../../../../model/utils/repo-config";
import type { Brief, LivePrState } from "../../../../model/types";
import { GroupViewKinds } from "../../../../model/utils/remainder";
import type {
  BriefViewModel,
  UnattributedRemainderGroupView,
} from "../../../../model/utils/view-model";
import { AccessibleLink } from "@web/components/AccessibleLink";
import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import { PRODUCT_NAME } from "@web/components/Header/consts";
import { AccountMenu } from "@web/features/account";
import { Button } from "@web/components/Button";
import { LocSign, LocSigns } from "@web/components/LocSign";
import { CoreLinesDisclosure } from "../CoreLinesDisclosure";
import { UnattributedDisclosure } from "../UnattributedDisclosure";
import { RiskChipDisclosure } from "../RiskChipDisclosure";
import { BranchPair } from "./BranchPair";
import { BriefDetailsPanel } from "./BriefDetailsPanel";
import { ProviderBadge } from "./ProviderBadge";
import { StackChip } from "./StackChip";
import { StackArrows } from "./StackChip/StackArrows";
import { resolveStackView } from "./StackChip/utils";
import { StateBadge } from "./StateBadge";
import { SubmitReviewCta } from "./SubmitReviewCta";
import { ComparisonControls } from "./ComparisonControls";
import { Icon } from "@web/components/Icon";
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
  model: BriefViewModel;
  totals: ProgressTotals;
  progress: number;
  openSubmit: () => void;
  draftCommentCount: number;
  availability: CompareOptionFlags;
  compareState: BriefSearch;
  /**
   * The DB route's notices and compare controls: rendered in the local
   * ComparisonControls' slot so BOTH paths keep their controls in the sticky
   * header, discoverable and never scrolled out of reach.
   */
  controlsSlot?: ReactNode | undefined;
  ownDraft?: OwnDraftHeaderProps | undefined;
  revisionPending?: boolean | undefined;
  jumpToGroup: (groupId: string) => void;
  jumpToGroupHeading: (groupId: string) => void;
  /** The Account menu's Keyboard shortcuts row opens the shortcuts modal. */
  toggleShortcuts: () => void;
  /** Focus mode quiets the header and drops its comparison row and progress bar. */
  focusMode: boolean;
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
  focusMode,
}: HeaderProps) {
  const { t } = useTranslation();
  const stackView = resolveStackView(
    brief.pr.stack,
    livePrState?.stack,
    livePrState?.state,
  );
  const headerRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  // The whole pinned stack at rest, not just the header, content must clear
  // the toolbar too. At rest only, or trigger and result chase each other.
  const [restHeight, setRestHeight] = useState(0);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) {
      return;
    }
    let lastHeight = "";
    let settle = 0;
    const apply = () => {
      const next = `${el.offsetHeight}px`;
      if (next === lastHeight) {
        return;
      }
      lastHeight = next;
      document.documentElement.style.setProperty("--top-bar-h", next);
      if (collapsedRef.current) {
        return;
      }
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
    if (!sentinel || restHeight === 0) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (!entry) {
          return;
        }
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
  const prLink = buildGithubPullUrl(brief.pr.repo, brief.pr.number);
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
      data-focus={focusMode ? "" : undefined}
    >
      <div className={styles["identityRow"]}>
        {/* Lead is inert on wide viewports (display: contents, one flex
            line); at ≤880px it becomes the grid's content row, with the CTA +
            account menu columns beside it. */}
        <div className={styles["lead"]}>
          <Link className={styles["wordmark"]} to="/">
            {PRODUCT_NAME}
          </Link>
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
                    #{brief.pr.number}
                    <Icon name={IconNames.GITHUB_LOGO} size={IconSizes.SM} />
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
                <StackArrows
                  currentNumber={brief.pr.number}
                  repoSlug={brief.pr.repo}
                  repoId={repoId}
                  stack={stackView.stack}
                >
                  <StackChip
                    asOf={stackView.asOf}
                    atGeneration={stackView.atGeneration}
                    currentNumber={brief.pr.number}
                    repoSlug={brief.pr.repo}
                    repoId={repoId}
                    snapshot={stackView.snapshot}
                    stack={stackView.stack}
                  />
                </StackArrows>
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
        <AccountMenu onOpenShortcuts={toggleShortcuts} />
      </div>
      {/* Tier 2, the comparison toolbar: everything that changes WHAT is on
          screen (Scope, Compare), flattened to one wrappable line, plus the
          quiet stats group parked at the far end. */}
      <div className={styles["comparisonRow"]}>
        {controlsSlot !== undefined ? (
          <div className={styles["comparisonCluster"]}>{controlsSlot}</div>
        ) : (
          <ComparisonControls
            availability={availability}
            briefId={briefId}
            compareState={compareState}
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
    if (!tooltipVisible) {
      return;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
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
    if (!hovered && !focused) {
      setTooltipDismissed(false);
    }
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

interface ProgressBarStyle extends CSSProperties {
  "--progress-scale": string;
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
  if (!anyPresent) {
    return null;
  }
  const anyError =
    repoConfig.files.some(
      (file) =>
        REPO_CONFIG_ERROR_OUTCOMES.has(file.outcome) ||
        file.warning !== undefined,
    ) || repoConfig.collisions.length > 0;
  if (!anyError) {
    return null;
  }
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
