// Bodies pass through VERBATIM: the web parses the same generation output, so
// re-shaping here could only lose data. Every write is a content-addressed
// upsert, so a re-run rewrites the same rows in place. Only brief,
// revision-narrative, comparison/revchanges and delta files have a database
// home; diffs, comments and the manifest have none. Skipped
// files are reported, and a *.brief.json that fails to map (the pre-index
// format) is reported apart from the routine skips: the cutover would lose it.
import { readdir } from "node:fs/promises";
import { createArtifactStore, createTenantRepository } from "persistence";
import type { AppDatabase } from "persistence";
import { collectArtifactFiles } from "./logic/collect-files";
import { writeBriefs } from "./logic/briefs";
import { writeComparisonMarks } from "./logic/comparison-marks";
import { writeDeltas } from "./logic/deltas";
import { writeNarratives } from "./logic/narratives";
import { writePullRequestRows } from "./logic/pull-request-rows";
import type { IngestBriefOptions, IngestRun, IngestSummary } from "./types";

export type {
  IngestBriefOptions,
  IngestSummary,
  RepoResolution,
  ResolveRepo,
} from "./types";
import { buildStemIndex } from "./utils";

/**
 * Ingest one artifact directory into rows under `ctx`. Returns counts and the
 * skipped file names; throws on a malformed artifact (a partial ingest of a
 * corrupt directory would be harder to notice than a loud stop).
 */
export async function ingestBriefDirectory(
  handle: AppDatabase,
  options: IngestBriefOptions,
): Promise<IngestSummary> {
  const run: IngestRun = {
    dir: options.dir,
    repo: createTenantRepository(handle, options.ctx),
    store: createArtifactStore(handle, options.ctx),
    log: options.log ?? (() => undefined),
    skipped: [],
    unmapped: [],
  };

  const names = (await readdir(options.dir)).toSorted();
  const files = await collectArtifactFiles(run, names);

  const resolved = await writePullRequestRows(
    run,
    files.briefFiles,
    options.resolveRepo,
  );

  const briefs = await writeBriefs(run, files.briefFiles, resolved);
  const narratives = await writeNarratives(run, files.narrativeNames, resolved);
  const marks = await writeComparisonMarks(
    run,
    files.comparisonNames,
    files.revchangesNames,
    buildStemIndex(resolved.prRows),
  );
  const deltas = await writeDeltas(run, files.deltaNames, resolved);

  for (const name of run.unmapped) {
    run.log(`UNMAPPED brief: ${name} — pre-index format, NOT ingested`);
  }

  return {
    briefs,
    narratives,
    marks,
    deltas,
    skipped: run.skipped,
    unmapped: run.unmapped,
  };
}
