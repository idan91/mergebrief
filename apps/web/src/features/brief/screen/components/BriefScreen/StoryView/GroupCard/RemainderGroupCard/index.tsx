import type { UnattributedRemainderGroupView } from "../../../../../../model/utils/viewModel";
import { ChunkStrip } from "../../../ChunkStrip";
import { GroupFacts } from "../../../GroupFacts";
import { MetaRow } from "../../../GroupFacts/MetaRow";
import { GroupFactsSurfaces } from "../../../GroupFacts/types";
import { deriveGroupHeadingId } from "../../../utils";
import { SinceMarker } from "../SinceMarker";
import styles from "../GroupCard.module.scss";
import type { GroupCardProps } from "../types";

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
  openDeltaLens,
}: RemainderGroupCardProps) {
  const headingId = deriveGroupHeadingId(group.id);
  const sinceMarker =
    sinceBaselineShortSha === undefined ? null : (
      <SinceMarker
        baselineShortSha={sinceBaselineShortSha}
        changedFileCount={sinceChangedFileCount ?? 0}
        openDeltaLens={openDeltaLens}
      />
    );

  return (
    <article className={`${styles["card"]} reveal`} id={id}>
      <div className={styles["head"]}>
        <MetaRow
          group={group}
          total={model.groups.length}
          trailing={sinceMarker}
        />
        <GroupFacts
          group={group}
          headingId={headingId}
          surface={GroupFactsSurfaces.CARD}
        />
      </div>
      <div className={styles["stripSection"]}>
        <ChunkStrip
          chunks={group.chunks}
          groupId={group.id}
          jumpToChunk={jumpToChunk}
        />
      </div>
    </article>
  );
}
