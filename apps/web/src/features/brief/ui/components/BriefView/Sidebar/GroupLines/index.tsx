import { useTranslation } from "react-i18next";
import { useState } from "react";

import { Callout } from "@web/components/Callout";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { GroupViewKinds } from "../../../../../model/utils/remainder";
import { getCategoryLabel } from "../../../../../model/utils/view-model";
import type { GroupView } from "../../../../../model/utils/view-model";
import { resolveGroupName } from "../../../../../model/utils/resolve-group-name";
import type { JumpFromSidebar } from "../types";
import styles from "./GroupLines.module.scss";

export interface GroupLinesProps {
  groups: GroupView[];
  activeGroupId: string | null;
  groupThreadCounts?: ReadonlyMap<string, number> | undefined;
  jumpToGroup: JumpFromSidebar;
}

interface CalloutState {
  groupId: string;
  anchor: HTMLElement;
}

/** One line per change group: the current one stays lit, hover names it. */
export function GroupLines({
  groups,
  activeGroupId,
  groupThreadCounts,
  jumpToGroup,
}: GroupLinesProps) {
  const { t } = useTranslation();
  const [callout, setCallout] = useState<CalloutState | null>(null);

  const calloutGroup = callout
    ? groups.find((group) => group.id === callout.groupId)
    : undefined;
  const calloutThreadCount =
    calloutGroup === undefined
      ? 0
      : (groupThreadCounts?.get(calloutGroup.id) ?? 0);

  return (
    <nav aria-label={t("brief.toc.ariaLabel")} className={styles["lines"]}>
      {groups.map((group) => {
        const threadCount = groupThreadCounts?.get(group.id) ?? 0;
        const current = group.id === activeGroupId;
        const threadsNote =
          threadCount > 0
            ? t("brief.toc.srThreads", { count: threadCount })
            : "";
        const name = `${resolveGroupName(t, group)}${threadsNote}`;
        return (
          // oxlint-disable-next-line house/no-raw-button -- mini-map tick with a pseudo-element hit area
          <button
            aria-current={current ? "true" : undefined}
            aria-label={name}
            className={styles["line"]}
            data-current={current ? "" : undefined}
            key={group.id}
            type="button"
            onBlur={() => setCallout(null)}
            onClick={(event) => jumpToGroup(group.id, event)}
            onFocus={(event) =>
              setCallout({ groupId: group.id, anchor: event.currentTarget })
            }
            onPointerEnter={(event) =>
              setCallout({ groupId: group.id, anchor: event.currentTarget })
            }
          >
            {threadCount > 0 ? (
              <Icon
                className={styles["threads"]}
                name={IconNames.CHAT_FILL}
                size={IconSizes.SM}
              />
            ) : null}
          </button>
        );
      })}
      {callout && calloutGroup ? (
        // Keyed per line: a fresh hover system per anchor, so the previous
        // line's close never clears the next line's callout.
        <Callout
          anchor={callout.anchor}
          compact
          fit
          key={callout.groupId}
          placement="left"
          onClose={() =>
            setCallout((current) =>
              current?.groupId === calloutGroup.id ? null : current,
            )
          }
        >
          <Callout.Eyebrow>
            {calloutGroup.kind === GroupViewKinds.ATTRIBUTED
              ? getCategoryLabel(t, calloutGroup.group.dominantCategory)
              : t("brief.unattributed.label")}
          </Callout.Eyebrow>
          <Callout.Title clamp={2}>
            {resolveGroupName(t, calloutGroup)}
          </Callout.Title>
          {calloutThreadCount > 0 ? (
            <Callout.Context>
              {t("brief.toc.threadCount", { count: calloutThreadCount })}
            </Callout.Context>
          ) : null}
        </Callout>
      ) : null}
    </nav>
  );
}
