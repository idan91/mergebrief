import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { CONTENT_START_ATTR } from "../utils";
import {
  useEffect,
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
import type { Brief, LivePrState } from "../../../../model/types";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import { AuthorChip } from "@web/components/AuthorChip";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import { PRODUCT_NAME } from "@web/components/Header/consts";
import MergeBriefMark from "@web/components/icons/mergebrief-mark.svg?react";
import { AccountMenu } from "@web/features/account";
import { LocSign, LocSigns } from "@web/components/LocSign";
import { MarkLoader } from "@web/components/MarkLoader";
import { MarkLoaderTones } from "@web/components/MarkLoader/types";
import { CoreLinesDisclosure } from "../CoreLinesDisclosure";
import { UnattributedDisclosure } from "../UnattributedDisclosure";
import { BranchPair } from "../BranchPair";
import { PrRef } from "../PrRef";
import { SelfReviewChip } from "../SelfReviewChip";
import { StackNav } from "../StackNav";
import { StateBadge } from "../StateBadge";
import { useCollapseMotion } from "./useCollapseMotion";
import { useLargeTitleOut } from "./useLargeTitleOut";
import { MarkReadyCta } from "../MarkReadyCta";
import type { OwnDraftHeaderProps } from "../types";
import { SubmitReviewCta } from "../SubmitReviewCta";
import { ComparisonControls } from "../ComparisonControls";
import { deriveStatFigures, findCountedRemainder } from "../stats";
import styles from "./Header.module.scss";

export interface HeaderProps {
  brief: Brief;
  livePrState?: LivePrState | undefined;
  /** The PR author's GitHub login; the meta line leads with it. */
  authorLogin?: string | undefined;
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
  /** The page's large title block; on phones the bar shows the title once it scrolls under. */
  largeTitle: HTMLElement | null;
  /** A sideways phone's one row; CSS shows it in place of the identity row. */
  landscapeRow?: ReactNode | undefined;
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
  livePrState,
  authorLogin,
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
  largeTitle,
  landscapeRow,
}: HeaderProps) {
  const { t } = useTranslation();
  const headerRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  // The whole pinned stack at rest, not just the header, content must clear
  // the toolbar too. At rest only, or trigger and result chase each other.
  const [restHeight, setRestHeight] = useState(0);
  const [barHeight, setBarHeight] = useState(0);
  const motion = useCollapseMotion(headerRef, collapsed);
  const { captureCollapseStart } = motion;

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
        // A collapse can land while the settle waits; measuring then would
        // take the collapsed stack as the resting line.
        if (collapsedRef.current) {
          return;
        }
        setRestHeight(readStickyStackHeight());
        setBarHeight(el.offsetHeight);
      }, SETTLE_MS);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      window.clearTimeout(settle);
      observer.disconnect();
      document.documentElement.style.removeProperty("--top-bar-h");
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
        const aboveLine = entry.boundingClientRect.top <= line;
        // Only a change in isIntersecting notifies, so a sentinel the
        // observer counts as in view must read as expanded or the next
        // crossing never arrives.
        const next = !entry.isIntersecting && aboveLine;
        if (next !== collapsedRef.current) {
          captureCollapseStart();
        }
        collapsedRef.current = next;
        setCollapsed(next);
      },
      // Margining by the RESTING height leaves the rest-minus-collapsed
      // difference as hysteresis, so a crossing cannot flap against itself.
      { rootMargin: `-${restHeight}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [restHeight, captureCollapseStart]);

  const largeTitleOut = useLargeTitleOut(barHeight, largeTitle);

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

  const titleOut = largeTitleOut ? "" : undefined;
  const progressStyle: ProgressBarStyle = {
    "--progress-scale": `${progress / 100}`,
  };
  const remainderGroup = findCountedRemainder(model);
  const statFigures = deriveStatFigures(totals, ownDraft !== undefined);

  return (
    <header
      className={styles["header"]}
      ref={headerRef}
      data-collapsed={collapsed ? "" : undefined}
      data-focus={focusMode ? "" : undefined}
      data-title-out={titleOut}
    >
      {landscapeRow}
      <div className={styles["identityRow"]} ref={motion.identityRowRef}>
        <Link
          aria-label={t("shell.backToBriefs")}
          className={styles["back"]}
          to="/"
        >
          <Icon
            name={IconNames.CARET_DOWN}
            rotation={IconRotations.QUARTER}
            size={IconSizes.LG}
          />
        </Link>
        {/* Lead is inert on wide viewports (display: contents, one flex
            line); at 880px and under it is the row's title cell. */}
        <div className={styles["lead"]}>
          <Link aria-label={PRODUCT_NAME} className={styles["home"]} to="/">
            <MergeBriefMark
              aria-hidden="true"
              className={styles["mark"]}
              focusable="false"
            />
          </Link>
          <div className={styles["titleBlock"]}>
            <span
              aria-hidden="true"
              className={styles["titleGhost"]}
              data-title={brief.pr.title}
              ref={motion.titleGhostRef}
            />
            <div className={styles["titleLine"]}>
              <h1 className={styles["title"]} ref={motion.titleRef}>
                {brief.pr.title}
              </h1>
              <StateBadge live={livePrState} pr={brief.pr} />
              {ownDraft !== undefined ? <SelfReviewChip /> : null}
              <PrRef pr={brief.pr} />
            </div>
            {/* PR identity: author, stack, branches. Never wraps above
                880px: a second wrap would put the block at three lines at
                rest and two collapsed, which moves --top-bar-h mid-scroll. */}
            <span className={styles["metaLine"]} ref={motion.metaLineRef}>
              {authorLogin !== undefined ? (
                <AuthorChip login={authorLogin} />
              ) : null}
              <StackNav
                brief={brief}
                livePrState={livePrState}
                repoId={repoId}
              />
              <BranchPair
                baseRef={brief.pr.baseRef}
                headRef={brief.pr.headRef}
              />
            </span>
          </div>
        </div>
        <span aria-hidden="true" className={styles["spacer"]} />
        {ownDraft !== undefined ? (
          <MarkReadyCta
            className={styles["terminalSlot"]}
            ownDraft={ownDraft}
            slotRef={terminalSlotRef}
            onBlur={() => {
              terminalSlotFocused.current = false;
            }}
            onFocus={() => {
              terminalSlotFocused.current = true;
            }}
          />
        ) : (
          <SubmitReviewCta
            className={styles["terminalSlot"]}
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
        <span className={styles["account"]}>
          <AccountMenu onOpenShortcuts={toggleShortcuts} />
        </span>
      </div>
      {/* Tier 2, the comparison toolbar: everything that changes WHAT is on
          screen (Scope, Compare), flattened to one wrappable line, plus the
          quiet stats group parked at the far end. */}
      <div className={styles["comparisonRow"]} ref={motion.comparisonRowRef}>
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
          <MarkLoader testId="revision-loader" tone={MarkLoaderTones.MUTED} />
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
              <b>{statFigures.chunks}</b>
            </div>
            <div className={`stat ${styles["stat"]}`}>
              {t("brief.header.flags")}
              <b>{statFigures.flags}</b>
            </div>
          </div>
        </div>
      </div>
      <div
        aria-hidden="true"
        className={styles["progressBar"]}
        ref={motion.progressBarRef}
        style={progressStyle}
      />
    </header>
  );
}

interface ProgressBarStyle extends CSSProperties {
  "--progress-scale": string;
}
