// The ingest mapping: a directory of CLI brief artifacts → database rows,
// under an EXPLICIT scope (installation tenant or url-box owner). Bodies pass
// through VERBATIM — the files were written by the same generation pipeline
// the web parses, so re-shaping them here could only lose data. Idempotent by
// construction: every write is the stores' content-addressed upsert, so a
// re-run rewrites the same rows in place.
//
// What maps where:
//   <stem>_<index>_<head8>.brief.json                → `brief` rows
//   <stem>_<index>_<head8>.revision-narrative.json   → `revision_narrative`
//   <stem>_(previous-brief|checkpoint)_<a8>-<b8>.comparison.json
//   <stem>_<index>_<head8>.revchanges.json (the legacy marks alias)
//                                                    → `comparison_marks`
//   <stem>-<base8>..<head8>.delta.json               → `delta` rows
// Everything else (.diffs.json, .comments.json, the manifest) has no database
// home: the repo route reads diffs and conversations live from GitHub. Skipped
// files are reported, never silent — and a *.brief.json that fails to map (the
// pre-index format) is reported LOUDLY apart from the routine skips: it is
// data the cutover would otherwise lose.
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
