import { useTranslation } from "react-i18next";

import { LocSign, LocSigns } from "@web/components/LocSign/LocSign";
import { resolveGroupName } from "../../../../../utils/resolveGroupName";
import type { UnattributedRemainderGroupView } from "../../../../../utils/viewModel";
import { deriveGroupHeadingId } from "../../../utils";
import { SinceMarker } from "../SinceMarker/SinceMarker";
import styles from "../GroupCard.module.scss";
import type { GroupCardProps } from "../types";

export interface RemainderGroupCardProps extends Omit<GroupCardProps, "group"> {
  group: UnattributedRemainderGroupView;
}

export function RemainderGroupCard({
  id,
  group,
  model,
  sinceChangedFileCount,
  sinceBaselineShortSha,
  openDeltaLens,
}: RemainderGroupCardProps) {
  const { t } = useTranslation();
  return (
    <article className={`${styles["card"]} reveal`} id={id}>
      <div className={styles["head"]}>
        <div className={styles["eyebrow"]}>
          <span className={styles["number"]}>
            {t("brief.group.changeGroupOf", {
              index: group.index + 1,
              total: model.groups.length,
            })}
          </span>
          <div className={styles["metrics"]}>
            <span className={styles["loc"]}>
              <LocSign sign={LocSigns.ADD} count={group.added} /> /{" "}
              <LocSign sign={LocSigns.DEL} count={group.deleted} />
            </span>
            {sinceBaselineShortSha !== undefined ? (
              <SinceMarker
                baselineShortSha={sinceBaselineShortSha}
                changedFileCount={sinceChangedFileCount ?? 0}
                openDeltaLens={openDeltaLens}
              />
            ) : null}
          </div>
        </div>
        <h2
          className={styles["title"]}
          id={deriveGroupHeadingId(group.id)}
          tabIndex={-1}
        >
          {resolveGroupName(t, group)}
        </h2>
        <p className={styles["summary"]}>
          {t("brief.unattributed.remainderSummary")}
        </p>
        {group.readingOrderStep !== undefined ? (
          <p className={styles["readingOrder"]}>
            {t("brief.group.stepOf", {
              step: group.readingOrderStep,
              total: model.groups.length,
            })}
          </p>
        ) : null}
      </div>
    </article>
  );
}
