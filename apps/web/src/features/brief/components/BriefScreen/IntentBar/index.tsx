import { Trans, useTranslation } from "react-i18next";
import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Badge } from "@web/components/Badge";
import { Chip } from "@web/components/Chip";
import { IconButton } from "@web/components/IconButton";
import { ToolbarButton } from "@web/components/ToolbarButton";
import type { IntentCheck, IntentItem } from "../../../types";
import {
  ALARM_GLYPH,
  CLAMP_THRESHOLD,
  CLAMP_VISIBLE,
  UNAVAILABLE_REASON_KEY,
} from "./consts";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import styles from "./IntentBar.module.scss";
import { TicketAlignment } from "./TicketAlignment";
import {
  isHttpUrl,
  partitionIntentCheck,
  type IntentBucketSpec,
} from "./utils";

export interface IntentBarProps {
  intentCheck: IntentCheck;
  /** Reuses the BriefScreen group-jump machinery (the TocBar path). */
  jumpToGroup: (groupId: string) => void;
  /**
   * Change-group titles by id, for the go-to buttons' name and hover
   * tooltip, a bare ↳ says nothing about WHERE it goes. An unknown id
   * keeps the plain label.
   */
  groupTitles?: Record<string, string> | undefined;
}

export interface IntentBarHandle {
  /** Expand the body and scroll the bar into view. */
  expandAndScrollTo: () => void;
}

export interface IntentItemRowProps {
  item: IntentItem;
  jumpToGroup: (groupId: string) => void;
  groupTitles: Record<string, string>;
  /** The primary ticket's URL; an item quoting it is labelled "ticket". */
  ticketUrl?: string | undefined;
}

interface IntentSourceBadgeProps {
  item: IntentItem;
  linked: boolean;
  sourceLabel: string;
}

/** Where the quote came from: a link, or "PR description" when there is no URL. */
function IntentSourceBadge({
  item,
  linked,
  sourceLabel,
}: IntentSourceBadgeProps) {
  const { t } = useTranslation();

  if (linked) {
    return <Badge href={item.sourceUrl}>{sourceLabel}</Badge>;
  }
  if (item.sourceUrl === "" && item.quote !== "") {
    return (
      <Badge>
        <span>{t("brief.intent.prDescription")}</span>
      </Badge>
    );
  }
  return null;
}

function IntentItemRow({
  item,
  jumpToGroup,
  groupTitles,
  ticketUrl,
}: IntentItemRowProps) {
  const { t } = useTranslation();
  const linked = item.sourceUrl !== "" && isHttpUrl(item.sourceUrl);
  const fromTicket = linked && item.sourceUrl === ticketUrl;
  const sourceLabel = fromTicket
    ? t("brief.intent.ticket")
    : t("brief.intent.source");
  // ids-multi disambiguation: a visible id only where the ambiguity
  // exists, claims carrying several groups.
  const multiGroup = item.groupIds.length > 1;
  return (
    <li className={styles["item"]}>
      <span aria-hidden="true" className={styles["marker"]}>
        ▪
      </span>
      <span className={styles["itemBody"]}>
        <span className={styles["intent"]}>{item.intent}</span>
        {item.quote !== "" || linked ? (
          <span className={styles["itemMeta"]}>
            {/* Text-only: model-produced quote, never markdown/HTML. */}
            {item.quote !== "" ? (
              <q className={styles["quote"]}>{item.quote}</q>
            ) : null}
            <IntentSourceBadge
              item={item}
              linked={linked}
              sourceLabel={sourceLabel}
            />
          </span>
        ) : null}
      </span>
      {item.groupIds.length > 0 ? (
        <span className={styles["gotoSet"]}>
          {item.groupIds.map((groupId) => {
            const groupTitle = groupTitles[groupId];
            const label =
              groupTitle === undefined
                ? t("brief.intent.jumpToGroup", { groupId })
                : t("brief.intent.jumpToGroupTitled", {
                    groupId,
                    title: groupTitle,
                  });
            return (
              <IconButton
                autoWidth={multiGroup}
                className={styles["goto"]}
                key={groupId}
                label={label}
                onClick={() => jumpToGroup(groupId)}
                title={label}
              >
                ↳
                {multiGroup ? (
                  <span className={styles["gotoId"]}>{groupId}</span>
                ) : null}
              </IconButton>
            );
          })}
        </span>
      ) : null}
    </li>
  );
}

export interface IntentBucketProps {
  bucket: IntentBucketSpec;
  jumpToGroup: (groupId: string) => void;
  groupTitles: Record<string, string>;
  ticketUrl?: string | undefined;
}

function IntentBucket({
  bucket,
  jumpToGroup,
  groupTitles,
  ticketUrl,
}: IntentBucketProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const clampable = bucket.items.length > CLAMP_THRESHOLD;
  const clamped = clampable && !expanded;
  const visibleItems = clamped
    ? bucket.items.slice(0, CLAMP_VISIBLE)
    : bucket.items;

  return (
    <div className={styles["bucket"]}>
      <h4 className={styles["bucketLabel"]}>
        {bucket.alarm ? (
          <span aria-hidden="true" className={styles["alarmGlyph"]}>
            {ALARM_GLYPH}
          </span>
        ) : null}
        {t(bucket.labelKey)}
      </h4>
      {bucket.alarm ? (
        <p className={styles["caution"]}>{t("brief.intent.alarmCaution")}</p>
      ) : null}
      <ul className={styles["bucketList"]} id={listId}>
        {/* Content key: the list is immutable per prop and intent+quote
            is effectively unique within a bucket. */}
        {visibleItems.map((item) => (
          <IntentItemRow
            groupTitles={groupTitles}
            item={item}
            jumpToGroup={jumpToGroup}
            key={`${item.intent}::${item.quote}`}
            ticketUrl={ticketUrl}
          />
        ))}
      </ul>
      {clampable ? (
        <Chip
          aria-controls={listId}
          aria-expanded={!clamped}
          className={styles["showAll"]}
          onClick={() => setExpanded((value) => !value)}
        >
          {clamped
            ? t("brief.intent.showAll", { count: bucket.items.length })
            : t("brief.intent.showFewer")}
        </Chip>
      ) : null}
    </div>
  );
}

/** One frozen default so the prop keeps its identity across renders. */
const NO_GROUP_TITLES: Readonly<Record<string, string>> = {};

/**
 * Keep the neutral bucket counts visible and the body initially collapsed.
 * Never auto-expand from model inference, which could anchor the reviewer.
 * Broad and absent intent sources show one quiet unavailability line.
 */
export const IntentBar = forwardRef<IntentBarHandle, IntentBarProps>(
  function IntentBar(
    { intentCheck, jumpToGroup, groupTitles = NO_GROUP_TITLES },
    ref,
  ) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const sectionRef = useRef<HTMLElement>(null);
    const panelId = useId();

    // Stable handle, `setOpen` and `sectionRef` are referentially fixed, so
    // the empty dep array keeps the ref identity constant across renders.
    useImperativeHandle(
      ref,
      () => ({
        expandAndScrollTo: () => {
          setOpen(true);
          sectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        },
      }),
      [],
    );

    const { specificity, scopeNote, primaryTicket, alignment } = intentCheck;
    const available = specificity === "precise";

    const partition = partitionIntentCheck(intentCheck);
    const ticketUrl = primaryTicket?.url;
    const checksOut = partition.checksOut.map((bucket) => (
      <IntentBucket
        bucket={bucket}
        groupTitles={groupTitles}
        jumpToGroup={jumpToGroup}
        key={bucket.key}
        ticketUrl={ticketUrl}
      />
    ));
    const needsALook = partition.needsALook.map((bucket) => (
      <IntentBucket
        bucket={bucket}
        groupTitles={groupTitles}
        jumpToGroup={jumpToGroup}
        key={bucket.key}
        ticketUrl={ticketUrl}
      />
    ));

    return (
      <section className={styles["bar"]} data-intent-bar="" ref={sectionRef}>
        <h2 className={styles["heading"]}>
          <ToolbarButton
            aria-controls={panelId}
            aria-expanded={open}
            className={styles["toggle"]}
            onClick={() => setOpen((value) => !value)}
          >
            <span
              aria-hidden
              className={styles["twist"]}
              data-open={open || undefined}
            >
              <Icon
                name={IconNames.CARET_DOWN}
                rotation={
                  open ? IconRotations.NONE : IconRotations.THREE_QUARTERS
                }
                size={IconSizes.SM}
              />
            </span>
            <span className={styles["title"]}>{t("brief.intent.title")}</span>
            {available ? (
              <span className={styles["counts"]}>
                {/* Every count stays neutral and uncolored, an alarm count
                  reads exactly like the others; the register lives in the
                  body's caution lines, not here. */}
                <span className={styles["count"]}>
                  <Trans
                    components={[<b className={styles["countNum"]} key="n" />]}
                    count={intentCheck.accomplished.length}
                    i18nKey="brief.intent.accomplished"
                  />
                </span>
                <span className={styles["count"]}>
                  <Trans
                    components={[<b className={styles["countNum"]} key="n" />]}
                    count={intentCheck.claimedButUnachieved.length}
                    i18nKey="brief.intent.claimedButUnachieved"
                  />
                </span>
                <span className={styles["count"]}>
                  <Trans
                    components={[<b className={styles["countNum"]} key="n" />]}
                    count={intentCheck.deviations.length}
                    i18nKey="brief.intent.deviations"
                  />
                </span>
                <span className={styles["count"]}>
                  <Trans
                    components={[<b className={styles["countNum"]} key="n" />]}
                    count={intentCheck.statedButMissing.length}
                    i18nKey="brief.intent.statedButMissing"
                  />
                </span>
                <span className={styles["count"]}>
                  <Trans
                    components={[<b className={styles["countNum"]} key="n" />]}
                    count={intentCheck.doneButUnstated.length}
                    i18nKey="brief.intent.doneButUnstated"
                  />
                </span>
              </span>
            ) : (
              <span className={styles["unavailable"]}>
                {t("brief.intent.unavailable", {
                  reason: t(UNAVAILABLE_REASON_KEY[specificity]),
                })}
              </span>
            )}
          </ToolbarButton>
        </h2>
        <div className={styles["panel"]} hidden={!open} id={panelId}>
          {scopeNote !== "" ? (
            <p className={styles["scopeNote"]}>{scopeNote}</p>
          ) : null}
          {primaryTicket ? (
            <TicketAlignment
              alignment={alignment}
              primaryTicket={primaryTicket}
              specificity={specificity}
            />
          ) : null}
          {available ? (
            <div className={styles["split"]}>
              <div className={styles["splitCol"]}>
                <h3 className={styles["splitHead"]}>
                  {t("brief.intent.splitChecksOut")}
                </h3>
                {checksOut.length > 0 ? (
                  checksOut
                ) : (
                  <p className={styles["splitEmpty"]}>
                    {t("brief.intent.emptyChecksOut")}
                  </p>
                )}
              </div>
              <div className={styles["splitCol"]}>
                <h3 className={styles["splitHead"]}>
                  {t("brief.intent.splitNeedsALook")}
                </h3>
                {needsALook.length > 0 ? (
                  needsALook
                ) : (
                  <p className={styles["splitEmpty"]}>
                    {t("brief.intent.emptyNeedsALook")}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    );
  },
);
