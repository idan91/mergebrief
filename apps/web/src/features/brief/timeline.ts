import type { LocalBriefSummary } from "./types";

export interface BriefTimelinePoint {
  briefId: string;
  deltaId?: string;
  headSha: string;
  index: number;
}

export interface BriefTimeline {
  points: BriefTimelinePoint[];
  selectedPoint: BriefTimelinePoint | undefined;
}

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
  const deltasByHead = new Map(
    prArtifacts
      .filter(
        (artifact) => artifact.artifactKind === "delta" && artifact.headSha,
      )
      .map((artifact) => [artifact.headSha as string, artifact.id]),
  );
  const points = prArtifacts
    .filter((artifact) => artifact.artifactKind === "brief")
    .map((artifact) => {
      const deltaId = deltasByHead.get(artifact.sha);
      return {
        briefId: artifact.id,
        ...(deltaId ? { deltaId } : {}),
        headSha: artifact.sha,
        index: artifact.index ?? Number.MAX_SAFE_INTEGER,
      } satisfies BriefTimelinePoint;
    })
    .sort((a, b) => a.index - b.index);
  const selectedHead =
    selected.artifactKind === "delta" ? selected.headSha : selected.sha;
  return {
    points,
    selectedPoint: points.find((point) => point.headSha === selectedHead),
  };
}
