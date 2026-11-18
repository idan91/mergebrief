import { truncateToCodeUnits } from "../../context/utils";
import type { FileId, HunkId, IndexedFile } from "../../diff/hunk-index/types";
import type { HunkMapEntry } from "../../types";
import { GenerationWarningKinds } from "../warnings/types";
import type { HunkMapInput, ResolvedHunkMap } from "./types";

/**
 * `f12`, `f12h3` or `f12h2-h5` as the markers spell them; a colon after the
 * file id (`f12:h3`) and the file id repeated on a run's end (`f12h2-f12h5`)
 * are tolerated, as are spaces around `:` and `-`.
 */
const HUNK_ITEM =
  /^\s*f(\d{1,7})\s*(?::?\s*h(\d{1,7})\s*(?:-\s*(?:f(\d{1,7})\s*:?\s*)?h(\d{1,7}))?)?\s*$/;
/** `f3-f8`: every file from the first id to the last, each claimed as if named alone. */
const FILE_RUN_ITEM = /^\s*f(\d{1,7})\s*-\s*f(\d{1,7})\s*$/;
/** Far past the longest id the pattern accepts; a longer item is rejected before the regex runs. */
const HUNK_ITEM_MAX_CHARS = 64;
const ITEM_SPAN_MAX_CHARS = 40;
const LISTED_IDS_MAX = 20;
/** Claims a map may spend per hunk and file of the diff; a map naming each once spends at most one. */
const CLAIMS_PER_ID = 2;

interface FileClaim {
  kind: "file";
  fileId: FileId;
}

interface HunkClaim {
  kind: "hunks";
  fileId: FileId;
  from: number;
  to: number;
}

type Claim = FileClaim | HunkClaim;

interface Owner {
  groupId: string;
  rank: number;
}

/** A model-written item as a warning may show it: one line, cut short. */
function describeItem(item: string): string {
  const oneLine = item.replace(/\s+/g, " ").trim();
  return oneLine.length <= ITEM_SPAN_MAX_CHARS
    ? oneLine
    : `${truncateToCodeUnits(oneLine, ITEM_SPAN_MAX_CHARS)}...`;
}

function listIds(ids: readonly string[]): string {
  const shown = ids.slice(0, LISTED_IDS_MAX).join(", ");
  return ids.length > LISTED_IDS_MAX
    ? `${shown} and ${ids.length - LISTED_IDS_MAX} more`
    : shown;
}

/**
 * Reads one item against the files it may name. A shortened file is claimed
 * whole whatever hunk part the item carries, since it has one chunk; a run
 * on a file read in full must sit within its hunks.
 */
function parseHunkItem(
  item: string,
  filesById: ReadonlyMap<FileId, IndexedFile>,
  shortenedFileIds: ReadonlySet<FileId>,
): Claim | undefined {
  const match = HUNK_ITEM.exec(item);
  if (match === null) {
    return undefined;
  }
  const fileId: FileId = `f${Number(match[1])}`;
  const file = filesById.get(fileId);
  const runEndsInFile =
    match[3] === undefined || Number(match[3]) === Number(match[1]);
  if (file === undefined || !runEndsInFile) {
    return undefined;
  }
  if (shortenedFileIds.has(fileId) || match[2] === undefined) {
    return { kind: "file", fileId };
  }

  const from = Number(match[2]);
  const to = match[4] === undefined ? from : Number(match[4]);
  const inRange = from >= 1 && from <= to && to <= file.hunks.length;
  return inRange ? { kind: "hunks", fileId, from, to } : undefined;
}

/**
 * Reads a run of whole files. File ids are dense from `f1` in diff order
 * once the files the outline left out count, so a run whose two ends are
 * files of this diff names only files of it and steps over the left-out
 * ones; a run reaching past the diff is rejected before anything expands.
 */
function parseFileRunItem(
  match: RegExpExecArray,
  filesById: ReadonlyMap<FileId, IndexedFile>,
  omittedFileIds: ReadonlySet<FileId>,
): FileClaim[] | undefined {
  const first = Number(match[1]);
  const last = Number(match[2]);
  const firstId: FileId = `f${first}`;
  const lastId: FileId = `f${last}`;
  const runLength = last - first + 1;
  const diffFileCount = filesById.size + omittedFileIds.size;
  if (runLength < 1 || runLength > diffFileCount) {
    return undefined;
  }
  if (!filesById.has(firstId) || !filesById.has(lastId)) {
    return undefined;
  }

  const claims: FileClaim[] = [];
  for (let position = first; position <= last; position += 1) {
    const fileId: FileId = `f${position}`;
    if (omittedFileIds.has(fileId)) {
      continue;
    }
    if (!filesById.has(fileId)) {
      return undefined;
    }
    claims.push({ kind: "file", fileId });
  }
  return claims;
}

function parseItem(
  item: string,
  filesById: ReadonlyMap<FileId, IndexedFile>,
  input: HunkMapInput,
): Claim[] | undefined {
  if (item.length > HUNK_ITEM_MAX_CHARS) {
    return undefined;
  }
  const fileRun = FILE_RUN_ITEM.exec(item);
  if (fileRun !== null) {
    return parseFileRunItem(
      fileRun,
      filesById,
      input.omittedFileIds ?? new Set(),
    );
  }
  const claim = parseHunkItem(item, filesById, input.shortenedFileIds);
  return claim === undefined ? undefined : [claim];
}

function listClaimedHunkIds(
  claim: Claim,
  filesById: ReadonlyMap<FileId, IndexedFile>,
): HunkId[] {
  const file = filesById.get(claim.fileId);
  if (file === undefined) {
    return [];
  }
  if (claim.kind === "file") {
    return file.hunks.map((hunk) => hunk.id);
  }
  return file.hunks.slice(claim.from - 1, claim.to).map((hunk) => hunk.id);
}

/** Keeps the earlier group in reading order; reports a conflict only when the groups differ. */
function claimOwner<Id extends HunkId | FileId>(
  owners: Map<Id, Owner>,
  id: Id,
  owner: Owner,
  conflicts: Set<Id>,
): void {
  const current = owners.get(id);
  if (current === undefined) {
    owners.set(id, owner);
    return;
  }
  if (current.groupId === owner.groupId) {
    return;
  }
  conflicts.add(id);
  if (owner.rank < current.rank) {
    owners.set(id, owner);
  }
}

interface ClaimLedger {
  hunkOwners: Map<HunkId, Owner>;
  fileOwners: Map<FileId, Owner>;
  hunkConflicts: Set<HunkId>;
  fileConflicts: Set<FileId>;
  /** `<groupId> <fileId>` per whole-file claim already recorded, so a repeat expands nothing. */
  wholeFileClaims: Set<string>;
  /** Claims left to record; each claim spends one per hunk or shortened file it walks, and at least one. */
  claimBudget: number;
  rejected: string[];
  overBudget: string[];
}

function recordClaim(
  claim: Claim,
  owner: Owner,
  input: HunkMapInput,
  filesById: ReadonlyMap<FileId, IndexedFile>,
  ledger: ClaimLedger,
): void {
  if (claim.kind === "file") {
    const claimKey = `${owner.groupId} ${claim.fileId}`;
    if (ledger.wholeFileClaims.has(claimKey)) {
      ledger.claimBudget -= 1;
      return;
    }
    ledger.wholeFileClaims.add(claimKey);
  }
  if (claim.kind === "file" && input.shortenedFileIds.has(claim.fileId)) {
    ledger.claimBudget -= 1;
    claimOwner(ledger.fileOwners, claim.fileId, owner, ledger.fileConflicts);
    return;
  }
  const hunkIds = listClaimedHunkIds(claim, filesById);
  ledger.claimBudget -= Math.max(1, hunkIds.length);
  for (const hunkId of hunkIds) {
    claimOwner(ledger.hunkOwners, hunkId, owner, ledger.hunkConflicts);
  }
}

function recordEntry(
  entry: HunkMapEntry,
  rank: number,
  input: HunkMapInput,
  filesById: ReadonlyMap<FileId, IndexedFile>,
  ledger: ClaimLedger,
): void {
  const owner: Owner = { groupId: entry.groupId, rank };
  for (const item of entry.hunks) {
    if (ledger.claimBudget <= 0) {
      ledger.overBudget.push(describeItem(item));
      continue;
    }
    const claims = parseItem(item, filesById, input);
    if (claims === undefined) {
      ledger.rejected.push(describeItem(item));
      continue;
    }
    for (const claim of claims) {
      recordClaim(claim, owner, input, filesById, ledger);
    }
  }
}

function reportWarnings(
  ledger: ClaimLedger,
  unlistedHunkIds: readonly HunkId[],
  unlistedFileIds: readonly FileId[],
  input: HunkMapInput,
): void {
  const { warnings } = input;
  if (ledger.rejected.length > 0) {
    warnings.report({
      kind: GenerationWarningKinds.HUNK_MAP_REJECTED,
      message: `hunk map: ${ledger.rejected.length} item(s) name no file, hunk or group of this diff, skipped: ${listIds(ledger.rejected)}`,
      items: ledger.rejected,
    });
  }
  if (ledger.overBudget.length > 0) {
    warnings.report({
      kind: GenerationWarningKinds.HUNK_MAP_REJECTED,
      message: `hunk map: ${ledger.overBudget.length} item(s) past the claim budget of this diff, skipped: ${listIds(ledger.overBudget)}`,
      items: ledger.overBudget,
    });
  }
  const hunkConflicts = [...ledger.hunkConflicts];
  const fileConflicts = [...ledger.fileConflicts];
  const conflicts = [...hunkConflicts, ...fileConflicts];
  if (conflicts.length > 0) {
    warnings.report({
      kind: GenerationWarningKinds.HUNK_MAP_LISTED_TWICE,
      message: `hunk map: ${conflicts.length} hunk(s) or shortened file(s) listed under two groups, kept by the earlier group in reading order: ${listIds(conflicts)}`,
      hunkIds: hunkConflicts,
      fileIds: fileConflicts,
    });
  }
  const unlisted = [...unlistedHunkIds, ...unlistedFileIds];
  if (unlisted.length > 0) {
    warnings.report({
      kind: GenerationWarningKinds.HUNK_MAP_UNLISTED,
      message: `hunk map: ${unlisted.length} hunk(s) or shortened file(s) in no group, left to the unattributed remainder: ${listIds(unlisted)}`,
      hunkIds: unlistedHunkIds,
      fileIds: unlistedFileIds,
    });
  }
}

/**
 * Resolves the grouping call's hunk map over the indexed diff. An entry for
 * a group the grouping did not produce is rejected whole, as is an item
 * naming no file, a run past a file's last hunk or a run of files reaching
 * past the diff. A hunk two groups claim goes to the earlier group in reading
 * order; a hunk or shortened file no group claims is unlisted. Items past
 * the claim budget are skipped, so the work stays proportional to the diff
 * however many items the model writes. Every finding is one warning.
 */
export function resolveHunkMap(input: HunkMapInput): ResolvedHunkMap {
  const filesById = new Map(input.files.map((file) => [file.id, file]));
  const hunkCount = input.files.reduce(
    (sum, file) => sum + file.hunks.length,
    0,
  );
  const rankByGroup = new Map(input.groupIds.map((id, rank) => [id, rank]));
  const ledger: ClaimLedger = {
    hunkOwners: new Map(),
    fileOwners: new Map(),
    hunkConflicts: new Set(),
    fileConflicts: new Set(),
    wholeFileClaims: new Set(),
    claimBudget: CLAIMS_PER_ID * (hunkCount + input.files.length),
    rejected: [],
    overBudget: [],
  };

  for (const entry of input.entries) {
    const rank = rankByGroup.get(entry.groupId);
    if (rank === undefined) {
      ledger.rejected.push(...entry.hunks.map(describeItem));
      continue;
    }
    recordEntry(entry, rank, input, filesById, ledger);
  }

  const groupByShortenedFile = new Map<FileId, string>();
  const hunksByGroup = new Map<string, HunkId[]>();
  const unlistedHunkIds: HunkId[] = [];
  const unlistedFileIds: FileId[] = [];
  for (const file of input.files) {
    if (input.shortenedFileIds.has(file.id)) {
      const owner = ledger.fileOwners.get(file.id);
      if (owner === undefined) {
        unlistedFileIds.push(file.id);
      } else {
        groupByShortenedFile.set(file.id, owner.groupId);
      }
      continue;
    }
    for (const hunk of file.hunks) {
      const owner = ledger.hunkOwners.get(hunk.id);
      if (owner === undefined) {
        unlistedHunkIds.push(hunk.id);
        continue;
      }
      const hunks = hunksByGroup.get(owner.groupId) ?? [];
      hunks.push(hunk.id);
      hunksByGroup.set(owner.groupId, hunks);
    }
  }

  reportWarnings(ledger, unlistedHunkIds, unlistedFileIds, input);
  return {
    groupByShortenedFile,
    hunksByGroup,
    unlistedHunkIds,
    unlistedFileIds,
  };
}
