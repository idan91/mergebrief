import { createArtifactStore, type AppDatabase } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { composeBriefContextBody } from "./logic/keys";
import type {
  BriefQuery,
  DeltaQuery,
  MarksQuery,
  NarrativeQuery,
} from "./schemas";
import type { ReadArtifactResult } from "./types";

const NOT_FOUND: ReadArtifactResult = {
  ok: false,
  error: { kind: "not-found" },
};

interface StoredBody {
  readonly body: string;
}

function answerBody(stored: StoredBody | undefined): ReadArtifactResult {
  if (stored === undefined) {
    return NOT_FOUND;
  }
  return { ok: true, value: stored.body };
}

/** The whole-PR span artifact body for (base, head). */
export async function readBrief(
  handle: AppDatabase,
  access: PullRequestAccess,
  query: BriefQuery,
): Promise<ReadArtifactResult> {
  const { briefs } = createArtifactStore(handle, access.rowScope);
  const stored = await briefs.get(access.row.id, query.base, query.head);
  return answerBody(stored);
}

/** Comparison marks, coordinates only, for (baseline, head). */
export async function readMarks(
  handle: AppDatabase,
  access: PullRequestAccess,
  query: MarksQuery,
): Promise<ReadArtifactResult> {
  const { comparisonMarks } = createArtifactStore(handle, access.rowScope);
  const stored = await comparisonMarks.get(
    access.row.id,
    query.baseline,
    query.head,
  );
  return answerBody(stored);
}

/**
 * The pre-warmed reviewer-personal delta core for (baseline, head). A span
 * whose row is its skip record has no delta to serve.
 */
export async function readDelta(
  handle: AppDatabase,
  access: PullRequestAccess,
  query: DeltaQuery,
): Promise<ReadArtifactResult> {
  const { deltas } = createArtifactStore(handle, access.rowScope);
  const stored = await deltas.get(access.row.id, query.baseline, query.head);
  if (stored?.skipped === true) {
    return NOT_FOUND;
  }
  return answerBody(stored);
}

/** The revision narrative for (prevHead, head). */
export async function readNarrative(
  handle: AppDatabase,
  access: PullRequestAccess,
  query: NarrativeQuery,
): Promise<ReadArtifactResult> {
  const { revisionNarratives } = createArtifactStore(handle, access.rowScope);
  const stored = await revisionNarratives.get(
    access.row.id,
    query.prevHead,
    query.head,
  );
  return answerBody(stored);
}

/**
 * The brief's repo-config snapshot as a composed JSON envelope: the column
 * already holds validated JSON. `repoConfig` is null for older rows.
 */
export async function readBriefContext(
  handle: AppDatabase,
  access: PullRequestAccess,
  query: BriefQuery,
): Promise<ReadArtifactResult> {
  const { briefs } = createArtifactStore(handle, access.rowScope);
  const repoConfig = await briefs.getRepoConfig(
    access.row.id,
    query.base,
    query.head,
  );
  if (repoConfig === undefined) {
    return NOT_FOUND;
  }
  return { ok: true, value: composeBriefContextBody(repoConfig) };
}
