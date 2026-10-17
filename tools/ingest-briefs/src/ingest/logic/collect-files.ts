// Phase 1: sort the directory into artifact families. Brief bodies are read
// and parsed here because deciding which family a `.brief.json` belongs to
// (modern or pre-index) needs its metadata, not just its name.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ANY_BRIEF_SUFFIX,
  BRIEF_FILE,
  COMPARISON_FILE,
  DELTA_FILE,
  DELTA_SIDECAR,
  NARRATIVE_FILE,
  REVCHANGES_FILE,
} from "../consts";
import { BriefMetaSchema, LegacyBriefMetaSchema } from "../schemas";
import type { CollectedFiles, IngestRun, ParsedBriefFile } from "../types";
import { throwFileError } from "../utils";

async function readParsedBody(
  dir: string,
  name: string,
): Promise<{ body: string; json: unknown }> {
  const body = await readFile(join(dir, name), "utf8");
  try {
    return { body, json: JSON.parse(body) };
  } catch {
    return throwFileError(name, "not valid JSON");
  }
}

/** A modern `<stem>_<index>_<head8>.brief.json`. */
async function readModernBrief(
  dir: string,
  name: string,
): Promise<ParsedBriefFile> {
  const { body, json } = await readParsedBody(dir, name);
  const meta = BriefMetaSchema.safeParse(json);
  if (!meta.success) {
    return throwFileError(name, "brief body missing its metadata slice");
  }
  return { name, body, meta: meta.data };
}

/**
 * A `.brief.json` that is not the modern shape. `undefined` means not even the
 * pre-index shape: data the cutover would lose, reported apart from the
 * routine skips.
 */
async function readLegacyBrief(
  dir: string,
  name: string,
): Promise<ParsedBriefFile | undefined> {
  const { body, json } = await readParsedBody(dir, name);
  const legacy = LegacyBriefMetaSchema.safeParse(json);
  if (!legacy.success) {
    return undefined;
  }
  return {
    name,
    body,
    legacy: true,
    meta: {
      pr: legacy.data.pr,
      index: 1,
      // Base filled from the repo resolution later; head is the only SHA the
      // pre-index body carries.
      commitRange: { base: "", head: legacy.data.pr.sha },
      changeGroups: legacy.data.changeGroups,
    },
  };
}

export async function collectArtifactFiles(
  run: IngestRun,
  names: readonly string[],
): Promise<CollectedFiles> {
  const briefFiles: ParsedBriefFile[] = [];
  const narrativeNames: string[] = [];
  const comparisonNames: string[] = [];
  const revchangesNames: string[] = [];
  const deltaNames: string[] = [];

  for (const name of names) {
    if (BRIEF_FILE.test(name)) {
      briefFiles.push(await readModernBrief(run.dir, name));
    } else if (NARRATIVE_FILE.test(name)) {
      narrativeNames.push(name);
    } else if (COMPARISON_FILE.test(name)) {
      comparisonNames.push(name);
    } else if (REVCHANGES_FILE.test(name)) {
      revchangesNames.push(name);
    } else if (!DELTA_SIDECAR.test(name) && DELTA_FILE.test(name)) {
      deltaNames.push(name);
    } else if (ANY_BRIEF_SUFFIX.test(name)) {
      const legacy = await readLegacyBrief(run.dir, name);
      if (legacy === undefined) {
        run.unmapped.push(name);
        continue;
      }
      briefFiles.push(legacy);
    } else {
      run.skipped.push(name);
    }
  }

  return {
    briefFiles,
    narrativeNames,
    comparisonNames,
    revchangesNames,
    deltaNames,
  };
}
