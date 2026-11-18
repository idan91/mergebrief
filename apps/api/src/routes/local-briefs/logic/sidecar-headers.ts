import type { Logger } from "logging";
import type { Result } from "types/utils";
import type { z } from "zod/v4";
import { COMPARISON_MARKS_SUFFIX, REVISION_CHANGES_SUFFIX } from "../consts";
import {
  comparisonMarksHeaderSchema,
  revisionChangesHeaderSchema,
} from "../schemas";
import {
  LocalBriefsFailureKinds,
  type ComparisonMarksEntry,
  type ComparisonMarksHeader,
  type LocalBriefsFailure,
  type RevisionChangesEntry,
  type RevisionChangesHeader,
} from "../types";
import { stripSuffix } from "../utils";
import { parseArtifactJson, readArtifactFile } from "./artifact-files";

function parseHeader<Header>(
  schema: z.ZodType<Header>,
  text: string,
  name: string,
  log: Logger,
): Result<Header, LocalBriefsFailure> {
  const json = parseArtifactJson(text, name, log);
  if (!json.ok) {
    return json;
  }

  const parsed = schema.safeParse(json.value);
  if (!parsed.success) {
    log.warn("local brief sidecar header invalid", { artifact: name });
    return { ok: false, error: { kind: LocalBriefsFailureKinds.UNREADABLE } };
  }
  return { ok: true, value: parsed.data };
}

function parseComparisonMarksHeader(
  text: string,
  name: string,
  log: Logger,
): Result<ComparisonMarksHeader, LocalBriefsFailure> {
  return parseHeader(comparisonMarksHeaderSchema, text, name, log);
}

export function parseRevisionChangesHeader(
  text: string,
  name: string,
  log: Logger,
): Result<RevisionChangesHeader, LocalBriefsFailure> {
  return parseHeader(revisionChangesHeaderSchema, text, name, log);
}

async function readComparisonMarksEntry(
  dir: string,
  id: string,
  name: string,
  log: Logger,
): Promise<ComparisonMarksEntry | undefined> {
  const text = await readArtifactFile(dir, name, log);
  if (!text.ok) {
    return undefined;
  }

  const header = parseComparisonMarksHeader(text.value, name, log);
  if (!header.ok) {
    return undefined;
  }
  return { id, ...header.value };
}

async function readRevisionChangesEntry(
  dir: string,
  id: string,
  name: string,
  log: Logger,
): Promise<RevisionChangesEntry | undefined> {
  const text = await readArtifactFile(dir, name, log);
  if (!text.ok) {
    return undefined;
  }

  const header = parseRevisionChangesHeader(text.value, name, log);
  if (!header.ok) {
    return undefined;
  }
  const { headSha, prevHeadSha, prevIndex } = header.value;
  return { id, headSha, prevHeadSha, prevIndex };
}

/** A broken marks sidecar drops its comparison, never the listing. */
export async function readComparisonMarksEntries(
  dir: string,
  names: readonly string[],
  log: Logger,
): Promise<ComparisonMarksEntry[]> {
  const reads = names.flatMap((name) => {
    const id = stripSuffix(name, COMPARISON_MARKS_SUFFIX);
    return id === undefined
      ? []
      : [readComparisonMarksEntry(dir, id, name, log)];
  });
  const entries = await Promise.all(reads);
  return entries.filter((entry) => entry !== undefined);
}

/** Legacy sidecars still offer Previous Brief; a broken one is skipped. */
export async function readRevisionChangesEntries(
  dir: string,
  names: readonly string[],
  log: Logger,
): Promise<RevisionChangesEntry[]> {
  const reads = names.flatMap((name) => {
    const id = stripSuffix(name, REVISION_CHANGES_SUFFIX);
    return id === undefined
      ? []
      : [readRevisionChangesEntry(dir, id, name, log)];
  });
  const entries = await Promise.all(reads);
  return entries.filter((entry) => entry !== undefined);
}
