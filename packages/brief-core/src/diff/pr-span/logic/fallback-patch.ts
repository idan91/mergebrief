import { POST_SIDE_PREFIX, PRE_SIDE_PREFIX } from "../../chunk-layout/consts";
import { FileVerdicts, type ComparedFile } from "../types";
import { readChangeRuns, splitPatchHunks } from "./change-runs";
import { cutHunkLines, readHunkLines, type HunkLine } from "./cut-lines";
import {
  formatDiffHeader,
  formatFileLines,
  formatGitPath,
  type BetweenHeadsHeader,
} from "./git-headers";

const DEV_NULL = "/dev/null";

/**
 * Whether each head holds the file, as the PR diffs say. A head whose PR
 * diff omits the file holds its base content, which a file the other head
 * adds is taken not to have.
 */
function readHeaderFacts(file: ComparedFile): BetweenHeadsHeader {
  const existsAtPrev = file.prev
    ? !file.prev.isDeleted
    : file.next?.isAdded !== true;
  const existsAtNew = file.next
    ? !file.next.isDeleted
    : file.prev?.isAdded !== true;
  return {
    prevPath: file.prevPath,
    path: file.path,
    existsAtPrev,
    existsAtNew,
    modeChange: file.modeChange,
    prevMode: file.prev?.mode,
    newMode: file.next?.mode,
  };
}

function formatBinaryLine(header: BetweenHeadsHeader): string {
  const prevSide = header.existsAtPrev
    ? formatGitPath(PRE_SIDE_PREFIX, header.prevPath)
    : DEV_NULL;
  const newSide = header.existsAtNew
    ? formatGitPath(POST_SIDE_PREFIX, header.path)
    : DEV_NULL;
  return `Binary files ${prevSide} and ${newSide} differ`;
}

/** A changed file only the headers can describe: binary content, a mode change, or a path change. */
export function formatHeaderOnlyPatch(file: ComparedFile): string {
  const header = readHeaderFacts(file);
  const lines = formatDiffHeader(header);
  const isBinary = file.prev?.isBinary === true || file.next?.isBinary === true;
  const contentDiffers = file.prev?.blobId !== file.next?.blobId;
  if (isBinary && contentDiffers) {
    lines.push(formatBinaryLine(header));
  }
  return lines.join("\n");
}

/**
 * A changed file no line diff can read, or whose line diff is all base
 * noise: the new PR patch's hunks holding a run the previous PR patch does
 * not, in new-head lines; every hunk for a file whose runs match but whose
 * context moved, since any run may have moved. A file the new PR diff no
 * longer holds keeps only its header.
 */
export function formatFallbackPatch(file: ComparedFile): string {
  const header = readHeaderFacts(file);
  const headerLines = formatDiffHeader(header);
  if (file.next === undefined) {
    return headerLines.join("\n");
  }

  const prevRunTexts = (file.prev?.runs ?? []).map((run) =>
    run.lines.join("\n"),
  );
  const runsMayHaveMoved = file.verdict === FileVerdicts.CONTEXT_MOVED;
  const prevRuns = new Set(runsMayHaveMoved ? [] : prevRunTexts);
  const newHunks = new Set<number>();
  for (const run of readChangeRuns(file.next.patch)) {
    if (!prevRuns.has(run.lines.join("\n"))) {
      newHunks.add(run.hunk);
    }
  }
  const { hunks } = splitPatchHunks(file.next.patch);
  const kept = hunks.filter((_hunk, index) => newHunks.has(index));
  if (kept.length === 0) {
    return headerLines.join("\n");
  }
  return [...headerLines, ...formatFileLines(header), ...kept.flat()].join(
    "\n",
  );
}

/** The previous PR patch's change lines: added lines by new-side line, removed lines counted by deletion point and text. */
interface PrevChangeLines {
  readonly addedAt: ReadonlySet<number>;
  readonly removedCounts: Map<string, number>;
}

function readRemovedKey(item: HunkLine): string {
  return `${item.newAt}\n${item.lines[0] ?? ""}`;
}

function readPrevChangeLines(patch: string): PrevChangeLines {
  const addedAt = new Set<number>();
  const removedCounts = new Map<string, number>();
  const { hunks } = splitPatchHunks(patch);
  const changes = hunks.flatMap(readHunkLines).filter((item) => item.isChange);
  for (const item of changes) {
    if (item.newCount > 0) {
      addedAt.add(item.newAt);
      continue;
    }
    const key = readRemovedKey(item);
    removedCounts.set(key, (removedCounts.get(key) ?? 0) + 1);
  }
  return { addedAt, removedCounts };
}

/** True for a change line the previous PR patch lacks; a matched removed line uses up its count. */
function isGivenBack(item: HunkLine, prev: PrevChangeLines): boolean {
  if (item.newCount > 0) {
    return !prev.addedAt.has(item.newAt);
  }
  const key = readRemovedKey(item);
  const left = prev.removedCounts.get(key) ?? 0;
  if (left === 0) {
    return true;
  }
  prev.removedCounts.set(key, left - 1);
  return false;
}

function cutGivenBackLines(
  hunk: readonly string[],
  prev: PrevChangeLines,
): string[] {
  const items = readHunkLines(hunk);
  const isKept = items.map((item) => item.isChange && isGivenBack(item, prev));
  return cutHunkLines(items, isKept);
}

/**
 * A file whose post-image both heads share over two bases: the new PR
 * patch's change lines the previous PR patch lacks, each with its context.
 * Both post-images are one blob, so added lines compare by new-side line
 * and removed lines by deletion point. Header only when the base gave
 * nothing back.
 */
export function formatReshapedPatch(file: ComparedFile): string {
  const header = readHeaderFacts(file);
  const headerLines = formatDiffHeader(header);
  if (file.next === undefined) {
    return headerLines.join("\n");
  }

  const prev = readPrevChangeLines(file.prev?.patch ?? "");
  const { hunks } = splitPatchHunks(file.next.patch);
  const cut = hunks.flatMap((hunk) => cutGivenBackLines(hunk, prev));
  if (cut.length === 0) {
    return headerLines.join("\n");
  }
  return [...headerLines, ...formatFileLines(header), ...cut].join("\n");
}
