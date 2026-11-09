import type { UnattributedRemainderGroupView } from "../../../../../../model/utils/view-model";
import { ChunkStrip } from "../../../ChunkStrip";
import { GroupCardHead } from "../GroupCardHead";
import { deriveGroupHeadingId } from "../../../utils";
import { RiskSurface } from "../RiskSurface";
import { SinceMarker } from "../SinceMarker";
import styles from "../GroupCard.module.scss";
import type { GroupCardProps } from "../types";
import { useRemainderGroupCardFacade } from "./useRemainderGroupCardFacade";

export interface RemainderGroupCardProps extends Omit<GroupCardProps, "group"> {
  group: UnattributedRemainderGroupView;
}

export function RemainderGroupCard({
  id,
  group,
  model,
  jumpToChunk,
  sinceChangedFileCount,
  sinceBaselineShortSha,
  openComparison,
}: RemainderGroupCardProps) {
  const {
    groupFlags,
    hasFlags,
    dispositions,
    flagsReadOnly,
    selectedFlagSet,
    reopenFlag,
    setDismissTarget,
    setEvidenceTarget,
    toggleRiskGroup,
  } = useRemainderGroupCardFacade({ group, model });
  const headingId = deriveGroupHeadingId(group.id);
  const sinceMarker =
    sinceBaselineShortSha === undefined ? undefined : (
      <SinceMarker
        baselineShortSha={sinceBaselineShortSha}
        changedFileCount={sinceChangedFileCount ?? 0}
        openComparison={openComparison}
      />
    );

  return (
    <article className={`${styles["card"]} reveal`} id={id}>
      <div className={styles["head"]}>
        <GroupCardHead
          group={group}
          headingId={headingId}
          sinceMarker={sinceMarker}
          total={model.groups.length}
        />
      </div>
      <div className={styles["stripSection"]}>
        <ChunkStrip
          chunks={group.chunks}
          groupId={group.id}
          jumpToChunk={jumpToChunk}
        />
      </div>
      {hasFlags ? (
        <RiskSurface
          dispositions={dispositions}
          flagsReadOnly={flagsReadOnly}
          followsReader
          group={group}
          groupFlags={groupFlags}
          jumpToChunk={jumpToChunk}
          reopenFlag={reopenFlag}
          selectedFlagSet={selectedFlagSet}
          setDismissTarget={setDismissTarget}
          setEvidenceTarget={setEvidenceTarget}
          toggleRiskGroup={toggleRiskGroup}
        />
      ) : null}
    </article>
  );
}
