// Hono-free: every op reads the configured out dir and answers a Result.
import type { LocalBriefSummary, LocalBriefView } from "contract";
import type { Result } from "types/utils";
import {
  readBriefView,
  readComparisonMarksSidecar,
  readDiffsSidecar,
  readRevisionNarrativeSidecar,
} from "./logic/artifact-reads";
import { listLocalBriefSummaries } from "./logic/summaries";
import type { LocalBriefsControllerDeps, LocalBriefsFailure } from "./types";

type ArtifactRead = Result<string, LocalBriefsFailure>;

function listLocalBriefs(
  deps: LocalBriefsControllerDeps,
): Promise<Result<LocalBriefSummary[], LocalBriefsFailure>> {
  return listLocalBriefSummaries(deps.dir, deps.log);
}

function readLocalBrief(
  deps: LocalBriefsControllerDeps,
  briefId: string,
): Promise<Result<LocalBriefView, LocalBriefsFailure>> {
  return readBriefView(deps.dir, briefId, deps.log);
}

function readLocalBriefDiffs(
  deps: LocalBriefsControllerDeps,
  briefId: string,
): Promise<ArtifactRead> {
  return readDiffsSidecar(deps.dir, briefId, deps.log);
}

function readLocalComparisonMarks(
  deps: LocalBriefsControllerDeps,
  marksId: string,
): Promise<ArtifactRead> {
  return readComparisonMarksSidecar(deps.dir, marksId, deps.log);
}

function readLocalRevisionNarrative(
  deps: LocalBriefsControllerDeps,
  narrativeId: string,
): Promise<ArtifactRead> {
  return readRevisionNarrativeSidecar(deps.dir, narrativeId, deps.log);
}

export const localBriefsController = {
  listLocalBriefs,
  readLocalBrief,
  readLocalBriefDiffs,
  readLocalComparisonMarks,
  readLocalRevisionNarrative,
};
