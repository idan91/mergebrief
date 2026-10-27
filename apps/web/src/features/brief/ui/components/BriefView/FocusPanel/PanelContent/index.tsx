import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import type { ChangeGroupCategory } from "types";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import type { BriefChunk } from "../../../../../model/types";
import {
  isAttributedGroupView,
  type BriefViewModel,
  type GroupView,
} from "../../../../../model/utils/view-model";
import { ChunkStrip } from "../../ChunkStrip";
import { GroupFacts } from "../../GroupFacts";
import { MetaRow } from "../../GroupFacts/MetaRow";
import { GroupFactsSurfaces } from "../../GroupFacts/types";
import { FileFacts } from "../FileFacts";
import styles from "./PanelContent.module.scss";

export interface PanelContentProps {
  model: BriefViewModel;
  group: GroupView;
  chunk: BriefChunk | undefined;
  /** The reader's dominant category, resolved; unset for the remainder. */
  dominant: ChangeGroupCategory | undefined;
  isReclassified: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  hide: () => void;
  jumpToChunk: (chunkId: string) => void;
}

/** The panel's head and scrolling body, in either layout. */
export function PanelContent({
  model,
  group,
  chunk,
  dominant,
  isReclassified,
  headingRef,
  hide,
  jumpToChunk,
}: PanelContentProps) {
  const { t } = useTranslation();
  const flagCount = model.flagsByGroup.get(group.id)?.length ?? 0;
  const chunkRiskMeta = chunk ? model.riskMetaByChunk.get(chunk.id) : undefined;
  const attributed = isAttributedGroupView(group);
  const chunkCarriesRisk = (chunk?.riskSurface.length ?? 0) > 0;
  const showsChunkRisks = attributed || chunkCarriesRisk;
  const closeButton = (
    <IconButton label={t("brief.focusPanel.hide")} onClick={hide}>
      <Icon name={IconNames.X} size={IconSizes.MD} />
    </IconButton>
  );

  return (
    <>
      <div className={styles["head"]}>
        <MetaRow
          group={group}
          total={model.groups.length}
          trailing={closeButton}
        />
      </div>
      <div
        aria-label={t("brief.focusPanel.detailsLabel")}
        className={styles["body"]}
        role="region"
        tabIndex={0}
      >
        <GroupFacts
          dominant={dominant}
          group={group}
          headingRef={headingRef}
          isReclassified={isReclassified}
          surface={GroupFactsSurfaces.PANEL}
        >
          {attributed ? (
            <p className={styles["flags"]}>
              {t("brief.group.flagsCount", { count: flagCount })}
            </p>
          ) : null}
        </GroupFacts>
        <div className={styles["strip"]}>
          <ChunkStrip
            chunks={group.chunks}
            groupId={group.id}
            key={group.id}
            jumpToChunk={jumpToChunk}
          />
        </div>
        {chunk ? (
          <FileFacts
            chunk={chunk}
            riskMeta={chunkRiskMeta}
            showRisks={showsChunkRisks}
          />
        ) : null}
      </div>
    </>
  );
}
