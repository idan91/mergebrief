import type { FileDiff } from "../diff/file-diff";
import { isAddedRow, parsePatchRows } from "../diff/patch-rows";
import {
  RiskSurfaceAttributes,
  type LineRange,
  type UnattributedFile,
} from "../types";
import { redactDiffSecrets } from "./redaction";
import { SecretKinds, type SecretHit } from "./redaction/types";

const ADDS_SECRET = RiskSurfaceAttributes.ADDS_SECRET;

interface RangedChunk {
  readonly file: string;
  readonly addedRanges: readonly LineRange[];
  readonly riskSurface: readonly string[];
}

export interface AddedSecretFlags<Chunk extends RangedChunk> {
  readonly chunks: Chunk[];
  readonly unattributed: UnattributedFile[];
}

/** A name-shaped value under a secret-named key is hidden from the model and is nothing to rotate. */
function isCredentialHit(hit: SecretHit): boolean {
  return hit.kind !== SecretKinds.KEYED_NAME;
}

/** New-side line numbers of added lines that hold a credential, by file. */
function findAddedSecretLines(
  fileDiffs: readonly Pick<FileDiff, "file" | "patch">[],
): Map<string, Set<number>> {
  const byFile = new Map<string, Set<number>>();
  for (const { file, patch } of fileDiffs) {
    const { hits } = redactDiffSecrets(patch);
    const credentials = hits.filter(isCredentialHit);
    const hitLines = new Set(credentials.map((hit) => hit.line));
    const added = parsePatchRows(patch).filter(
      (row) => isAddedRow(row) && hitLines.has(row.patchLine),
    );
    const lines = new Set(added.map((row) => row.newLine ?? 0));
    if (lines.size > 0) {
      byFile.set(file, lines);
    }
  }
  return byFile;
}

function coversAnyLine(
  ranges: readonly LineRange[],
  lines: ReadonlySet<number> | undefined,
): boolean {
  if (lines === undefined) {
    return false;
  }
  return ranges.some((range) =>
    [...lines].some((line) => line >= range.start && line <= range.end),
  );
}

/**
 * The pipeline owns `adds-secret`: every chunk loses it, then the chunks and
 * unattributed files whose added lines hold a credential gain it. The model
 * never sees the value, so only the raw diff can answer.
 */
export function flagAddedSecrets<Chunk extends RangedChunk>(
  chunks: readonly Chunk[],
  unattributed: readonly UnattributedFile[],
  fileDiffs: readonly Pick<FileDiff, "file" | "patch">[],
): AddedSecretFlags<Chunk> {
  const secretLines = findAddedSecretLines(fileDiffs);

  const flaggedChunks = chunks.map((chunk) => {
    const kept = chunk.riskSurface.filter((attr) => attr !== ADDS_SECRET);
    const addsSecret = coversAnyLine(
      chunk.addedRanges,
      secretLines.get(chunk.file),
    );
    const riskSurface = addsSecret ? [...kept, ADDS_SECRET] : kept;
    return { ...chunk, riskSurface };
  });
  const flaggedFiles = unattributed.map((file) => {
    const flagged: UnattributedFile = { ...file };
    delete flagged.riskSurface;
    if (coversAnyLine(file.addedRanges, secretLines.get(file.file))) {
      flagged.riskSurface = [ADDS_SECRET];
    }
    return flagged;
  });

  return { chunks: flaggedChunks, unattributed: flaggedFiles };
}
