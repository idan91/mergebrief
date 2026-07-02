import type { ComparisonAvailability, LocalBriefSummary } from "./types";

/**
 * @description One timeline point's Compare availability (ADR 0024 plan step
 * 5). Always present as an object; individual keys are absent when that
 * baseline has no mechanical marks for this head — timeline navigation itself
 * never depends on comparison availability (ADR 0019 decision 1 still holds).
 */
export interface BriefTimelinePoint {
  briefId: string;
  headSha: string;
  index: number;
  comparisons: ComparisonAvailability;
}

export interface BriefTimeline {
  points: BriefTimelinePoint[];
  selectedPoint: BriefTimelinePoint | undefined;
}

const EMPTY_COMPARISONS: ComparisonAvailability = {};

export function buildBriefTimeline(
  artifacts: LocalBriefSummary[],
  selectedId: string,
): BriefTimeline {
  const selected = artifacts.find((artifact) => artifact.id === selectedId);
  if (!selected) return { points: [], selectedPoint: undefined };

  const prArtifacts = artifacts.filter(
    (artifact) =>
      artifact.repo === selected.repo && artifact.number === selected.number,
  );
  const points = prArtifacts
    .filter((artifact) => artifact.artifactKind === "brief")
    .map(
      (artifact) =>
        ({
          briefId: artifact.id,
          headSha: artifact.sha,
          index: artifact.index ?? Number.MAX_SAFE_INTEGER,
          comparisons: artifact.comparisons ?? EMPTY_COMPARISONS,
        }) satisfies BriefTimelinePoint,
    )
    .sort((a, b) => a.index - b.index);
  const selectedHead =
    selected.artifactKind === "delta" ? selected.headSha : selected.sha;
  return {
    points,
    selectedPoint: points.find((point) => point.headSha === selectedHead),
  };
}
