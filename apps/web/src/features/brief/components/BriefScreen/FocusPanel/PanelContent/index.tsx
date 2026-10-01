import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import type { BriefChunk } from "../../../../types";
import {
  isAttributedGroupView,
  type BriefViewModel,
  type GroupView,
} from "../../../../utils/viewModel";
import { ChunkList } from "../ChunkList";
import { FileFacts } from "../FileFacts";
import { GroupFacts } from "../GroupFacts";
import styles from "./PanelContent.module.scss";

export interface PanelContentProps {
  model: BriefViewModel;
  group: GroupView;
  chunk: BriefChunk | undefined;
  activeChunkId: string | null;
  meta: string | undefined;
  headingRef: Ref<HTMLHeadingElement>;
  hide: () => void;
  jumpToChunk: (chunkId: string) => void;
}

/** The panel's head and scrolling body, in either layout. */
export function PanelContent({
  model,
  group,
  chunk,
  activeChunkId,
  meta,
  headingRef,
  hide,
  jumpToChunk,
}: PanelContentProps) {
  const { t } = useTranslation();
  const flagCount = model.flagsByGroup.get(group.id)?.length ?? 0;
  const chunkRiskMeta = chunk ? model.riskMetaByChunk.get(chunk.id) : undefined;
  const showRisks = isAttributedGroupView(group);

  return (
    <>
      <div className={styles["head"]}>
        <span className={styles["meta"]}>{meta}</span>
        <IconButton label={t("brief.focusPanel.hide")} onClick={hide}>
          <Icon name={IconNames.X} size={IconSizes.MD} />
        </IconButton>
      </div>
      <div
        aria-label={t("brief.focusPanel.detailsLabel")}
        className={styles["body"]}
        role="region"
        tabIndex={0}
      >
        <GroupFacts
          flagCount={flagCount}
          group={group}
          headingRef={headingRef}
        />
        {chunk ? (
          <FileFacts
            chunk={chunk}
            riskMeta={chunkRiskMeta}
            showRisks={showRisks}
          />
        ) : null}
        <ChunkList
          activeChunkId={activeChunkId}
          chunks={group.chunks}
          jumpToChunk={jumpToChunk}
        />
      </div>
    </>
  );
}
