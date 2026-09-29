import { useFlagSurface } from "../../../../hooks/useFlagSurface";
import type { BriefChunk } from "../../../../types";
import {
  resolveSectionFlags,
  type SectionRegion,
} from "../../../../utils/section-flags";
import type {
  AttributedGroupView,
  RiskFlag,
} from "../../../../utils/viewModel";
import { RiskSurface } from "../../StoryView/GroupCard/AttributedGroupCard/RiskSurface";
import styles from "./SectionFlags.module.scss";

export interface SectionFlagsProps {
  /** The group the section belongs to; the surface names it. */
  group: AttributedGroupView;
  /** The full brief's flags and chunks the section's regions are matched against. */
  flags: RiskFlag[];
  chunks: BriefChunk[];
  regions: SectionRegion[];
  jumpToChunk: (chunkId: string) => void;
}

/**
 * The full brief's flags on the chunks a Changes section touches, on the
 * same surface and the same disposition store as the group card, so a
 * decision made here shows there and back.
 */
export function SectionFlags({
  group,
  flags,
  chunks,
  regions,
  jumpToChunk,
}: SectionFlagsProps) {
  const sectionFlags = resolveSectionFlags(flags, chunks, regions);
  const surface = useFlagSurface(sectionFlags);
  if (sectionFlags.length === 0) {
    return null;
  }
  // The section's own files, in its order: a matched chunk can belong to
  // another group, whose files the group's chunk list would not name.
  const fileOrder = [...new Set(regions.map((region) => region.file))];

  return (
    <div className={styles["sectionFlags"]}>
      <RiskSurface
        dispositions={surface.dispositions}
        fileOrder={fileOrder}
        flagsReadOnly={surface.flagsReadOnly}
        group={group}
        groupFlags={sectionFlags}
        jumpToChunk={jumpToChunk}
        reopenFlag={surface.reopenFlag}
        selectedFlagSet={surface.selectedFlagSet}
        setDismissTarget={surface.setDismissTarget}
        setEvidenceTarget={surface.setEvidenceTarget}
        toggleRiskGroup={surface.toggleRiskGroup}
      />
    </div>
  );
}
