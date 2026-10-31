import {
  GIT_QUOTE,
  POST_SIDE_PREFIX,
  PRE_SIDE_PREFIX,
} from "../diff/chunk-layout/consts";
import {
  decodeGitPath,
  listPatchPaths,
  readPathLine,
} from "../diff/chunk-layout/logic/header-paths";
import type { PatchPathLine } from "../diff/chunk-layout/types";
import { splitDiffByFile, type FileDiff } from "../diff/file-diff";
import { indexDiff } from "../diff/hunk-index";
import {
  DiffFileStatuses,
  type DiffFileStatus,
} from "../diff/hunk-index/types";
import { RiskSurfaceAttributes, type UnattributedFile } from "../types";
import { detectLockfile } from "./shortened";
import type {
  PackageChanges,
  PackageVersion,
} from "./shortened/lockfiles/types";
import { REGISTRY_HOST, toRegistryIdentity } from "./shortened/lockfiles/utils";
import {
  LockfileFormats,
  type LockfileSummary,
  type PackageLockfileSummary,
} from "./shortened/types";

const CHANGES_PACKAGE_SOURCE = RiskSurfaceAttributes.CHANGES_PACKAGE_SOURCE;
/** The registries a lockfile with no base side may add from: npm's, yarn's and the one the repo configures. */
const PUBLIC_REGISTRIES = [
  REGISTRY_HOST,
  toRegistryIdentity("https://registry.npmjs.org"),
  toRegistryIdentity("https://registry.yarnpkg.com"),
];

/** Files that set the registry a lockfile names only by omission. */
const REGISTRY_CONFIG_FILES: ReadonlySet<string> = new Set([
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  // pnpm nests `registries:` maps; no line check sees a nested value change.
  "pnpm-workspace.yaml",
]);

/** What the rest of the PR changes that moves where a lockfile fetches from. */
export interface PackageSourceContext {
  /** The PR edits, adds, deletes or renames away `.npmrc`, `.yarnrc`, `.yarnrc.yml` or `pnpm-workspace.yaml`. */
  readonly registryConfigChanged: boolean;
  /** The registry config files the PR changes, by head path; each fires on its own. */
  readonly registryConfigFiles: ReadonlySet<string>;
}

interface FiledChunk {
  readonly file: string;
  readonly riskSurface: readonly string[];
}

/** A pnpm, npm or yarn lockfile a diff changes, keyed as its chunks are. */
export interface ChangedLockfile {
  path: string;
  status: DiffFileStatus;
  /** The path at base, on a rename. */
  previousPath?: string;
}

export interface PackageSourceFlags<Chunk extends FiledChunk> {
  readonly chunks: Chunk[];
  readonly unattributed: UnattributedFile[];
}

/** Whether two host lists name the same hosts; an unknown host matches none. */
function isSameHostSet(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  const leftHosts = new Set(left);
  const rightHosts = new Set(right);
  const sameHosts =
    leftHosts.size === rightHosts.size &&
    [...rightHosts].every((host) => leftHosts.has(host));
  return sameHosts;
}

/** A version's hosts as one comparable key; absent when one is unknown. */
function readHostKey(pkg: PackageVersion): string | undefined {
  return pkg.hosts?.join(" ");
}

/**
 * Whether a name that dropped and added versions without pairing them as
 * updates moves any one of them: every such version, dropped or added, must
 * carry the same known hosts.
 */
function movesUnpairedVersion(changes: PackageChanges): boolean {
  const droppedKeys = new Map<string, Set<string | undefined>>();
  for (const pkg of changes.removed) {
    const keys = droppedKeys.get(pkg.name) ?? new Set<string | undefined>();
    keys.add(readHostKey(pkg));
    droppedKeys.set(pkg.name, keys);
  }
  return changes.added.some((pkg) => {
    const keys = droppedKeys.get(pkg.name);
    if (keys === undefined) {
      return false;
    }
    const key = readHostKey(pkg);
    const keepsDroppedHosts =
      key !== undefined && keys.size === 1 && keys.has(key);
    return !keepsDroppedHosts;
  });
}

/** Whether a version change moves a package to another host. */
function movesPackageHost(changes: PackageChanges): boolean {
  const updateMoves = changes.updated.some(
    (update) => !isSameHostSet(update.fromHosts, update.toHosts),
  );
  const movesHost = updateMoves || movesUnpairedVersion(changes);
  return movesHost;
}

/**
 * Whether an added version, or with the registry config changed an updated
 * one too, comes from a source the lockfile's base side does not use, or
 * from an unknown one. A new lockfile has no base side, so only the public
 * registries count as known. A registry config change can redirect any
 * host (npm's `replace-registry-host`), so no source counts as known then.
 */
function addsNewHost(
  summary: PackageLockfileSummary,
  context: PackageSourceContext,
): boolean {
  const known = context.registryConfigChanged
    ? new Set<string>()
    : new Set(summary.baseHosts ?? PUBLIC_REGISTRIES);
  function isNewSource(hosts: readonly string[] | undefined): boolean {
    const namesNewHost =
      hosts === undefined || hosts.some((host) => !known.has(host));
    return namesNewHost;
  }

  const { added, updated } = summary.changes;
  const updatesMoved =
    context.registryConfigChanged &&
    updated.some((update) => isNewSource(update.toHosts));
  const addsFromNewSource = added.some((pkg) => isNewSource(pkg.hosts));
  return updatesMoved || addsFromNewSource;
}

/** Whether an npm alias appears on an added version or changes on an update. */
function changesAlias(changes: PackageChanges): boolean {
  const addsAlias = changes.added.some((pkg) => pkg.aliasOf !== undefined);
  const updateChangesAlias = changes.updated.some(
    (update) => update.fromAliasOf !== update.toAliasOf,
  );
  return addsAlias || updateChangesAlias;
}

const RENAME_FROM_LINE: PatchPathLine = { lead: "rename from ", side: "" };
const RENAME_TO_LINE: PatchPathLine = { lead: "rename to ", side: "" };
const MINUS_FILE_LINE: PatchPathLine = { lead: "--- ", side: PRE_SIDE_PREFIX };
const PLUS_FILE_LINE: PatchPathLine = { lead: "+++ ", side: POST_SIDE_PREFIX };
/** The lines naming the path the file had at base; a copy's source is not a path the file had. */
const OLD_PATH_LINES = [RENAME_FROM_LINE, MINUS_FILE_LINE];
/** The lines naming the path the file has at head. */
const NEW_PATH_LINES = [RENAME_TO_LINE, PLUS_FILE_LINE];
/** The header lines git writes for a change to a file's mode alone. */
const MODE_LINE = /^(?:old|new) mode \d+$/;

/** A path's file name, read through git's quoting: no lockfile or config name holds a quoted character. */
function readBasename(path: string): string {
  const unquoted = path.endsWith(GIT_QUOTE) ? path.slice(0, -1) : path;
  return unquoted.slice(unquoted.lastIndexOf("/") + 1);
}

/** The file's path at head and every path its header names at base. */
function listTouchedPaths({ file, patch }: FileDiff): string[] {
  return [file, ...listPatchPaths(patch, OLD_PATH_LINES)];
}

/** Every spelling of the file's head path, so a chunk keyed by any of them is found. */
function listHeadPathSpellings({ file, patch }: FileDiff): string[] {
  return [file, ...listPatchPaths(patch, NEW_PATH_LINES)];
}

/**
 * A path's file name as a case-insensitive file system matches it: git's
 * quoting decoded, canonically decomposed, then folded through upper case
 * so a letter that only folds (long s, Kelvin sign) meets its ASCII form.
 */
function readFoldedBasename(path: string): string {
  const fileName = readBasename(decodeGitPath(path));
  const decomposed = fileName.normalize("NFD");
  return decomposed.toUpperCase().toLowerCase();
}

function isRegistryConfigPath(path: string): boolean {
  return REGISTRY_CONFIG_FILES.has(readFoldedBasename(path));
}

/**
 * The registry config files a diff touches, by head path: any change to
 * one, a rename into or out of a config name included. Each fires on its
 * own, with or without a lockfile change: npm's ini and yarn's YAML accept
 * escaped and quoted spellings, so no line test can tell a change that
 * moves a registry from one that does not.
 */
export function listRegistryConfigFiles(
  fileDiffs: readonly FileDiff[],
): Set<string> {
  const files = new Set<string>();
  for (const fileDiff of fileDiffs) {
    if (!listTouchedPaths(fileDiff).some(isRegistryConfigPath)) {
      continue;
    }
    for (const path of listHeadPathSpellings(fileDiff)) {
      files.add(path);
    }
  }
  return files;
}

/** What `fileDiffs` change beyond the lockfiles that moves where packages install from. */
export function readPackageSourceContext(
  fileDiffs: readonly FileDiff[],
): PackageSourceContext {
  const registryConfigFiles = listRegistryConfigFiles(fileDiffs);
  return {
    registryConfigChanged: registryConfigFiles.size > 0,
    registryConfigFiles,
  };
}

/**
 * The rule for `changes-package-source`. A pnpm, npm or yarn lockfile fires
 * when its package changes were not read, when a version keeps its number
 * but changes its source or integrity, when a version change moves a
 * package to another fetch identity, when an npm alias appears or changes,
 * or when an added version comes from an identity the base side does not
 * use. With the registry config changed, the configured registry is no
 * longer known. Another ecosystem's lockfile never fires.
 */
export function changesPackageSource(
  summary: LockfileSummary,
  context: PackageSourceContext,
): boolean {
  if (summary.format === LockfileFormats.OTHER) {
    return false;
  }
  if ("unread" in summary) {
    return true;
  }
  const { changes } = summary;
  const movesSource =
    changes.sourceChanged.length > 0 ||
    movesPackageHost(changes) ||
    changesAlias(changes) ||
    addsNewHost(summary, context);
  return movesSource;
}

/**
 * Case-folded, unlike the summary's exact name: npm, pnpm and yarn open a
 * lockfile in another case on a case-insensitive file system, and with no
 * summary under that name it fires as unread.
 */
function isPackageLockfile(path: string): boolean {
  const format = detectLockfile(readFoldedBasename(path));
  return format !== undefined && format !== LockfileFormats.OTHER;
}

/**
 * Whether the patch's own `---`/`+++` lines, or its `rename to` line when it
 * has none, name the path its `diff --git` header was read as. A header that
 * splits two ways with no such line keeps a guess, which this leaves out.
 */
function confirmsPath(
  lockfile: ChangedLockfile,
  headerLines: string[],
): boolean {
  function listNamed(kind: PatchPathLine): string[] {
    return headerLines.flatMap((line) => readPathLine(line, [kind]) ?? []);
  }

  const basePath = lockfile.previousPath ?? lockfile.path;
  const hasFileLines = headerLines.some((line) =>
    line.startsWith(PLUS_FILE_LINE.lead),
  );
  if (!hasFileLines) {
    return listNamed(RENAME_TO_LINE).includes(lockfile.path);
  }
  const headNamed =
    lockfile.status === DiffFileStatuses.DELETED ||
    listNamed(PLUS_FILE_LINE).includes(lockfile.path);
  const baseNamed =
    lockfile.status === DiffFileStatuses.ADDED ||
    listNamed(MINUS_FILE_LINE).includes(basePath);
  return headNamed && baseNamed;
}

/** The lockfile one patch changes, or nothing when its path is not confirmed. */
function readChangedLockfile(
  path: string,
  patch: string,
): ChangedLockfile | undefined {
  const [indexed] = indexDiff(patch);
  if (indexed === undefined) {
    return undefined;
  }
  const lockfile: ChangedLockfile = { path, status: indexed.status };
  if (indexed.previousPath !== undefined) {
    lockfile.previousPath = indexed.previousPath;
  }
  return confirmsPath(lockfile, indexed.headerLines) ? lockfile : undefined;
}

/**
 * Every pnpm, npm or yarn lockfile `diff` changes whose path its patch
 * confirms, for the rule to read. A path left out has no summary, so it
 * fires; a path two patches share is left out, since chunks key by path.
 */
export function listChangedLockfiles(diff: string): ChangedLockfile[] {
  const lockfiles = new Map<string, ChangedLockfile>();
  const unconfirmed = new Set<string>();
  for (const fileDiff of splitDiffByFile(diff)) {
    if (!isPackageLockfile(fileDiff.file)) {
      continue;
    }
    const lockfile = readChangedLockfile(fileDiff.file, fileDiff.patch);
    const shared = lockfiles.has(fileDiff.file);
    if (lockfile === undefined || shared) {
      unconfirmed.add(fileDiff.file);
      continue;
    }
    lockfiles.set(fileDiff.file, lockfile);
  }
  return [...lockfiles.values()].filter(
    (lockfile) => !unconfirmed.has(lockfile.path),
  );
}

/** A patch that changes the file's mode and nothing else: no hunk, rename, copy or binary line. */
function isModeOnlyPatch(patch: string): boolean {
  let modeLines = 0;
  // Past the `diff --git` line; the first line that is no mode line ends the walk.
  for (
    let start = patch.indexOf("\n") + 1;
    start > 0 && start < patch.length;
  ) {
    const newline = patch.indexOf("\n", start);
    const end = newline === -1 ? patch.length : newline;
    const line = patch.slice(start, end);
    if (line !== "" && !MODE_LINE.test(line)) {
      return false;
    }
    modeLines += line === "" ? 0 : 1;
    start = end + 1;
  }
  return modeLines > 0;
}

/** The lockfile paths whose every patch only changes the mode: their bytes are the base's. */
function listModeOnlyLockfiles(fileDiffs: readonly FileDiff[]): Set<string> {
  const modeOnly = new Set<string>();
  const changed = new Set<string>();
  for (const { file, patch } of fileDiffs) {
    if (!isPackageLockfile(file)) {
      continue;
    }
    if (isModeOnlyPatch(patch)) {
      modeOnly.add(file);
    } else {
      changed.add(file);
    }
  }
  return new Set([...modeOnly].filter((file) => !changed.has(file)));
}

/**
 * Whether `changes-package-source` fires on a file, read once per path. A
 * lockfile whose patches only change its mode has no summary yet keeps its
 * bytes, so it does not fire; a registry config file fires on any change.
 */
function createFiresReader(
  summaries: ReadonlyMap<string, LockfileSummary>,
  context: PackageSourceContext,
  modeOnlyPaths: ReadonlySet<string>,
): (path: string) => boolean {
  const firesByPath = new Map<string, boolean>();
  return (path) => {
    const known = firesByPath.get(path);
    if (known !== undefined) {
      return known;
    }
    const summary = summaries.get(path);
    const lockfileChanged = isPackageLockfile(path) && !modeOnlyPaths.has(path);
    const lockfileFires =
      lockfileChanged &&
      (summary === undefined || changesPackageSource(summary, context));
    const configFires =
      isRegistryConfigPath(path) || context.registryConfigFiles.has(path);
    const fires = lockfileFires || configFires;
    firesByPath.set(path, fires);
    return fires;
  };
}

/**
 * A remainder entry with no ranges for each firing file no chunk or
 * remainder entry carries: a rename, a mode change or a binary diff has no
 * changed line to hold the flag.
 */
function listUncarriedFiles(
  fileDiffs: readonly FileDiff[],
  carried: ReadonlySet<string>,
  readFires: (path: string) => boolean,
): UnattributedFile[] {
  const listed = new Set<string>();
  const uncarried: UnattributedFile[] = [];
  for (const fileDiff of fileDiffs) {
    const skip = listed.has(fileDiff.file) || !readFires(fileDiff.file);
    if (skip) {
      continue;
    }
    listed.add(fileDiff.file);
    if (listHeadPathSpellings(fileDiff).some((path) => carried.has(path))) {
      continue;
    }
    uncarried.push({
      file: fileDiff.file,
      addedRanges: [],
      removedRanges: [],
      riskSurface: [CHANGES_PACKAGE_SOURCE],
    });
  }
  return uncarried;
}

/**
 * The pipeline owns `changes-package-source`: every chunk and unattributed
 * file loses it, then those in a pnpm, npm or yarn lockfile whose summary
 * fires the rule gain it, and those in a changed registry config file. A
 * lockfile with no summary fires unless its patches only change its mode.
 * A firing file of `fileDiffs` that nothing
 * carries joins the remainder with no ranges.
 */
export function flagPackageSourceChanges<Chunk extends FiledChunk>(
  chunks: readonly Chunk[],
  unattributed: readonly UnattributedFile[],
  summaries: ReadonlyMap<string, LockfileSummary>,
  context: PackageSourceContext,
  fileDiffs: readonly FileDiff[],
): PackageSourceFlags<Chunk> {
  const readFires = createFiresReader(
    summaries,
    context,
    listModeOnlyLockfiles(fileDiffs),
  );
  function reflag(riskSurface: readonly string[], path: string): string[] {
    const kept = riskSurface.filter((attr) => attr !== CHANGES_PACKAGE_SOURCE);
    return readFires(path) ? [...kept, CHANGES_PACKAGE_SOURCE] : kept;
  }

  const flaggedChunks = chunks.map((chunk) => ({
    ...chunk,
    riskSurface: reflag(chunk.riskSurface, chunk.file),
  }));

  const flaggedFiles = unattributed.map((file) => {
    const riskSurface = reflag(file.riskSurface ?? [], file.file);
    const flagged: UnattributedFile = { ...file };
    delete flagged.riskSurface;
    if (riskSurface.length > 0) {
      flagged.riskSurface = riskSurface;
    }
    return flagged;
  });

  const carried = new Set([
    ...chunks.map((chunk) => chunk.file),
    ...unattributed.map((file) => file.file),
  ]);
  const uncarried = listUncarriedFiles(fileDiffs, carried, readFires);

  return {
    chunks: flaggedChunks,
    unattributed: [...flaggedFiles, ...uncarried],
  };
}
