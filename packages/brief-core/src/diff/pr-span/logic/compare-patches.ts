import type { Mutable } from "types/utils";
import { parsePatchPaths } from "../../chunk-layout/logic/header-paths";
import { splitDiffByFile } from "../../file-diff";
import {
  BINARY_LINES,
  DELETED_FILE_LINE,
  INDEX_LINE,
  MODE_LINES,
  NEW_FILE_LINE,
} from "../consts";
import {
  FileVerdicts,
  type ComparedFile,
  type FileVerdict,
  type ModeChange,
  type PrFilePatch,
} from "../types";
import {
  hasSameRunContexts,
  hasSameRuns,
  readChangeRuns,
  splitPatchHunks,
} from "./change-runs";

function readPrFilePatch(file: string, patch: string): PrFilePatch {
  const paths = parsePatchPaths(patch);
  const { header } = splitPatchHunks(patch);
  const filePatch: Mutable<PrFilePatch> = {
    prePath: paths?.pre ?? file,
    postPath: paths?.post ?? file,
    patch,
    isAdded: header.some((line) => NEW_FILE_LINE.test(line)),
    isDeleted: header.some((line) => DELETED_FILE_LINE.test(line)),
    isBinary: header.some((line) => BINARY_LINES.test(line)),
    runs: readChangeRuns(patch),
  };

  for (const line of header) {
    const index = INDEX_LINE.exec(line);
    if (index?.[1] !== undefined && index[2] !== undefined) {
      filePatch.preBlobId = index[1];
      filePatch.blobId = index[2];
    }
    if (index?.[3] !== undefined) {
      filePatch.mode = index[3];
    }
    const mode = MODE_LINES.exec(line);
    if (mode?.[1] !== undefined) {
      filePatch.mode = mode[1];
    }
  }
  return filePatch;
}

/** Every file of one head's PR diff, keyed by its path at that head. */
function readPrFilePatches(diff: string): Map<string, PrFilePatch> {
  const patches = new Map<string, PrFilePatch>();
  for (const { file, patch } of splitDiffByFile(diff)) {
    const filePatch = readPrFilePatch(file, patch);
    patches.set(filePatch.postPath, filePatch);
  }
  return patches;
}

function isRenamed(filePatch: PrFilePatch): boolean {
  return filePatch.prePath !== filePatch.postPath;
}

function hasSameRunsInPlace(prev: PrFilePatch, next: PrFilePatch): boolean {
  const samePlaces = prev.runs.every(
    (run, index) => run.newStart === next.runs[index]?.newStart,
  );
  return samePlaces && hasSameRuns(prev.runs, next.runs);
}

/** Both heads hold the same blob; on two bases the PR's change on it can still differ. */
function decideSameBlobVerdict(
  prev: PrFilePatch,
  next: PrFilePatch,
): FileVerdict {
  const samePreBlob = prev.preBlobId === next.preBlobId;
  if (samePreBlob || hasSameRunsInPlace(prev, next)) {
    return FileVerdicts.IDENTICAL;
  }
  return FileVerdicts.CHANGE_RESHAPED_BY_BASE;
}

/** The file's content verdict at one path, mode aside. */
function decideContentVerdict(
  prev: PrFilePatch,
  next: PrFilePatch,
): FileVerdict {
  if (prev.prePath !== next.prePath) {
    return FileVerdicts.CONTENT_CHANGED;
  }
  const sameBlob = prev.blobId !== undefined && prev.blobId === next.blobId;
  if (sameBlob) {
    return decideSameBlobVerdict(prev, next);
  }
  if (prev.isBinary || next.isBinary) {
    return FileVerdicts.HEADER_CHANGED;
  }
  if (prev.isDeleted !== next.isDeleted) {
    return FileVerdicts.CONTENT_CHANGED;
  }
  // Same base content, different head content: the PR's change differs wherever its runs sit.
  const samePreBlob =
    prev.preBlobId !== undefined && prev.preBlobId === next.preBlobId;
  if (samePreBlob) {
    return FileVerdicts.CONTENT_CHANGED;
  }
  if (!hasSameRuns(prev.runs, next.runs)) {
    return FileVerdicts.CONTENT_CHANGED;
  }
  return hasSameRunContexts(prev.patch, next.patch)
    ? FileVerdicts.BASE_MOVED
    : FileVerdicts.CONTEXT_MOVED;
}

function readModeChange(
  prev: PrFilePatch,
  next: PrFilePatch,
): ModeChange | undefined {
  const bothExist = !prev.isDeleted && !next.isDeleted;
  if (!bothExist || prev.mode === undefined || next.mode === undefined) {
    return undefined;
  }
  if (prev.mode === next.mode) {
    return undefined;
  }
  return { prevMode: prev.mode, newMode: next.mode };
}

function comparePair(prev: PrFilePatch, next: PrFilePatch): ComparedFile {
  const compared: Mutable<ComparedFile> = {
    path: next.postPath,
    prevPath: prev.postPath,
    prev,
    next,
    verdict: decideContentVerdict(prev, next),
  };
  const modeChange = readModeChange(prev, next);
  if (modeChange === undefined) {
    return compared;
  }

  compared.modeChange = modeChange;
  const contentUnchanged =
    compared.verdict === FileVerdicts.IDENTICAL ||
    compared.verdict === FileVerdicts.BASE_MOVED;
  if (contentUnchanged) {
    compared.verdict = FileVerdicts.HEADER_CHANGED;
  }
  // A mode change reads changed whatever the line diff finds, so it keeps the content diff beside it.
  if (compared.verdict === FileVerdicts.CONTEXT_MOVED) {
    compared.verdict = FileVerdicts.CONTENT_CHANGED;
  }
  return compared;
}

/** A file only one head's PR diff holds: its change is new, or reverted to base. */
function decideLoneVerdict(filePatch: PrFilePatch): FileVerdict {
  return filePatch.isBinary
    ? FileVerdicts.HEADER_CHANGED
    : FileVerdicts.CONTENT_CHANGED;
}

function compareLoneNext(next: PrFilePatch): ComparedFile {
  return {
    path: next.postPath,
    prevPath: next.prePath,
    next,
    verdict: decideLoneVerdict(next),
  };
}

function compareLonePrev(prev: PrFilePatch): ComparedFile {
  return {
    path: prev.postPath,
    prevPath: prev.postPath,
    prev,
    verdict: decideLoneVerdict(prev),
  };
}

/** Two lone files one rename links: the path changed between heads, so the change did. */
function compareRenamePair(prev: PrFilePatch, next: PrFilePatch): ComparedFile {
  const compared = comparePair(prev, next);
  const isBinary = prev.isBinary || next.isBinary;
  const verdict = isBinary
    ? FileVerdicts.HEADER_CHANGED
    : FileVerdicts.CONTENT_CHANGED;
  return { ...compared, verdict };
}

function isLinkedByRename(prev: PrFilePatch, next: PrFilePatch): boolean {
  return (
    next.prePath === prev.postPath ||
    prev.prePath === next.postPath ||
    prev.prePath === next.prePath
  );
}

function isPlainEdit(filePatch: PrFilePatch): boolean {
  return !isRenamed(filePatch) && !filePatch.isAdded && !filePatch.isDeleted;
}

/** Both heads make one plain edit, same base blob, head blob and mode, under two paths. */
function isBaseRenameCandidate(prev: PrFilePatch, next: PrFilePatch): boolean {
  const sameBlobs =
    prev.preBlobId !== undefined &&
    prev.preBlobId === next.preBlobId &&
    prev.blobId === next.blobId;
  const sameMode = prev.mode === next.mode;
  return isPlainEdit(prev) && isPlainEdit(next) && sameBlobs && sameMode;
}

/** The one previous-head file `next` could be a base rename of, when neither side has a rival. */
function findBaseRenamePartner(
  next: PrFilePatch,
  loneNext: readonly PrFilePatch[],
  lonePrev: readonly PrFilePatch[],
): PrFilePatch | undefined {
  const partners = lonePrev.filter((prev) => isBaseRenameCandidate(prev, next));
  const [partner] = partners;
  if (partners.length !== 1 || partner === undefined) {
    return undefined;
  }
  const rivals = loneNext.filter((other) =>
    isBaseRenameCandidate(partner, other),
  );
  return rivals.length === 1 ? partner : undefined;
}

/**
 * Pair a file only the new diff holds with one only the previous diff
 * holds: first through a rename at either head, then as a base-rename
 * candidate, which `settleBaseRenames` keeps only once the swapped paths
 * read absent. The rest stay lone.
 */
function pairLoneFiles(
  loneNext: readonly PrFilePatch[],
  lonePrev: PrFilePatch[],
): ComparedFile[] {
  const compared: ComparedFile[] = [];
  const unlinked: PrFilePatch[] = [];
  for (const next of loneNext) {
    const renameIndex = lonePrev.findIndex((prev) =>
      isLinkedByRename(prev, next),
    );
    const renamed = lonePrev[renameIndex];
    if (renamed === undefined) {
      unlinked.push(next);
    } else {
      lonePrev.splice(renameIndex, 1);
      compared.push(compareRenamePair(renamed, next));
    }
  }

  const partners = unlinked.map((next) =>
    findBaseRenamePartner(next, unlinked, lonePrev),
  );
  for (const [index, next] of unlinked.entries()) {
    const partner = partners[index];
    if (partner === undefined) {
      compared.push(compareLoneNext(next));
      continue;
    }
    lonePrev.splice(lonePrev.indexOf(partner), 1);
    compared.push({
      path: next.postPath,
      prevPath: partner.postPath,
      prev: partner,
      next,
      verdict: FileVerdicts.BASE_RENAMED,
    });
  }
  return compared;
}

/**
 * Pair the two heads' PR diffs file by file on the new head's path, then
 * pair what is left through renames, and decide whether the PR's own change
 * to each file moved between them. A rename present at one head only reads
 * changed.
 */
export function comparePrDiffs(
  prevPrDiff: string,
  newPrDiff: string,
): ComparedFile[] {
  const prevFiles = readPrFilePatches(prevPrDiff);
  const nextFiles = readPrFilePatches(newPrDiff);
  const compared: ComparedFile[] = [];
  const loneNext: PrFilePatch[] = [];

  for (const [path, next] of nextFiles) {
    const prev = prevFiles.get(path);
    if (prev === undefined) {
      loneNext.push(next);
    } else {
      compared.push(comparePair(prev, next));
    }
  }

  const lonePrev = [...prevFiles.values()].filter(
    (prev) => !nextFiles.has(prev.postPath),
  );
  compared.push(...pairLoneFiles(loneNext, lonePrev));
  compared.push(...lonePrev.map(compareLonePrev));
  return compared.toSorted(compareFilePaths);
}

/** Code-unit order on the new-head path: the span's text and its line bound follow it, never the diff's own order. */
export function compareFilePaths(
  left: Pick<ComparedFile, "path">,
  right: Pick<ComparedFile, "path">,
): number {
  if (left.path < right.path) {
    return -1;
  }
  if (left.path > right.path) {
    return 1;
  }
  return 0;
}

/**
 * Keep the base-rename candidates whose new-head path is in `confirmed`;
 * every other candidate splits back into its two lone files, both changed.
 */
export function settleBaseRenames(
  compared: readonly ComparedFile[],
  confirmed: ReadonlySet<string>,
): ComparedFile[] {
  return compared.flatMap((file) => {
    const isCandidate = file.verdict === FileVerdicts.BASE_RENAMED;
    if (!isCandidate || confirmed.has(file.path)) {
      return [file];
    }
    const lone: ComparedFile[] = [];
    if (file.next !== undefined) {
      lone.push(compareLoneNext(file.next));
    }
    if (file.prev !== undefined) {
      lone.push(compareLonePrev(file.prev));
    }
    return lone;
  });
}
