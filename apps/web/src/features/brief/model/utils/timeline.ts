import {
  LocalBriefKinds,
  type LocalBriefSummary,
  type LocalComparisonAvailability,
} from "contract";

/**
 * @description One timeline point's Compare availability. Always present as an
 * object; individual keys are absent when that baseline has no mechanical
 * marks for this head. Timeline navigation itself never depends on
 * comparison availability.
 */
export interface BriefTimelinePoint {
  briefId: string;
  headSha: string;
  index: number;
  comparisons: LocalComparisonAvailability;
}

export interface BriefTimeline {
  points: BriefTimelinePoint[];
  selectedPoint: BriefTimelinePoint | undefined;
}

const EMPTY_COMPARISONS: LocalComparisonAvailability = {};

export function buildBriefTimeline(
  artifacts: LocalBriefSummary[],
  selectedId: string,
): BriefTimeline {
  const selected = artifacts.find((artifact) => artifact.id === selectedId);
  if (!selected) {
    return { points: [], selectedPoint: undefined };
  }

  const prArtifacts = artifacts.filter(
    (artifact) =>
      artifact.repo === selected.repo && artifact.number === selected.number,
  );
  const points = prArtifacts
    .filter((artifact) => artifact.artifactKind === LocalBriefKinds.BRIEF)
    .map(
      (artifact) =>
        ({
          briefId: artifact.id,
          headSha: artifact.sha,
          index: artifact.index ?? Number.MAX_SAFE_INTEGER,
          comparisons: artifact.comparisons ?? EMPTY_COMPARISONS,
        }) satisfies BriefTimelinePoint,
    )
    .toSorted((a, b) => a.index - b.index);
  const selectedHead =
    selected.artifactKind === LocalBriefKinds.DELTA
      ? selected.headSha
      : selected.sha;
  return {
    points,
    selectedPoint: points.find((point) => point.headSha === selectedHead),
  };
}
