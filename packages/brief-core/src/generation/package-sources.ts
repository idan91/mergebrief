import type { FileDiff } from "../diff/file-diff";
import { RiskSurfaceAttributes, type UnattributedFile } from "../types";
import { detectLockfile, summarizeLockfile } from "./shortened";
import type {
  PackageChanges,
  PackageVersion,
} from "./shortened/lockfiles/types";
import { REGISTRY_HOST, toRegistryIdentity } from "./shortened/lockfiles/utils";
import {
  LockfileFormats,
  LockfileSideKinds,
  type LockfileSides,
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

const UNAVAILABLE_SIDES: LockfileSides = {
  before: { kind: LockfileSideKinds.UNAVAILABLE },
  after: { kind: LockfileSideKinds.UNAVAILABLE },
};

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
  return updateMoves || movesUnpairedVersion(changes);
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

/** A patch header line naming the path the file had at base. */
const OLD_PATH_LINE = /^(?:rename from |--- "?a\/)(.+)$/;
/** A patch header line naming the path the file has at head. */
const NEW_PATH_LINE = /^(?:rename to |\+\+\+ "?b\/)(.+)$/;
/** git quotes a path holding a quote, a backslash, a control or a non-ASCII character. */
const GIT_QUOTE = '"';
/** One escape inside a git-quoted path: an octal byte or a backslashed character. */
const GIT_ESCAPE = /\\(?:([0-7]{3})|(.))/gs;
const GIT_CHAR_ESCAPES: Readonly<Record<string, string>> = {
  a: "\u0007",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};
const OCTAL_RADIX = 8;
const HUNK_START = "@@";

/** A path's file name, read through git's quoting: no lockfile or config name holds a quoted character. */
function readBasename(path: string): string {
  const unquoted = path.endsWith(GIT_QUOTE) ? path.slice(0, -1) : path;
  return unquoted.slice(unquoted.lastIndexOf("/") + 1);
}

/** Every path a patch's header lines name through `pattern`'s first group. */
function readHeaderPaths(patch: string, pattern: RegExp): string[] {
  const paths: string[] = [];
  // Header lines only: stop at the first hunk rather than split the whole patch.
  for (let start = 0; start < patch.length; ) {
    const newline = patch.indexOf("\n", start);
    const end = newline === -1 ? patch.length : newline;
    const line = patch.slice(start, end);
    if (line.startsWith(HUNK_START)) {
      break;
    }
    const path = pattern.exec(line)?.[1];
    if (path !== undefined) {
      paths.push(path);
    }
    start = end + 1;
  }
  return paths;
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

function appendUtf8(bytes: number[], text: string): void {
  for (const byte of UTF8_ENCODER.encode(text)) {
    bytes.push(byte);
  }
}

/**
 * A header path git quoted, decoded the way git encoded it: octal escapes
 * are UTF-8 bytes. An unquoted path comes back as is.
 */
function decodeGitPath(raw: string): string {
  const opened = raw.startsWith(GIT_QUOTE) ? raw.slice(1) : raw;
  if (!opened.endsWith(GIT_QUOTE)) {
    return raw;
  }
  const quoted = opened.slice(0, -1);
  const bytes: number[] = [];
  let copied = 0;
  for (const match of quoted.matchAll(GIT_ESCAPE)) {
    appendUtf8(bytes, quoted.slice(copied, match.index));
    const [escape, octal, char = ""] = match;
    if (octal === undefined) {
      appendUtf8(bytes, GIT_CHAR_ESCAPES[char] ?? char);
    } else {
      bytes.push(Number.parseInt(octal, OCTAL_RADIX));
    }
    copied = match.index + escape.length;
  }
  appendUtf8(bytes, quoted.slice(copied));
  return UTF8_DECODER.decode(new Uint8Array(bytes));
}

/** The file's path at head and every path its header names at base. */
function listTouchedPaths({ file, patch }: FileDiff): string[] {
  return [file, ...readHeaderPaths(patch, OLD_PATH_LINE)];
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
    // Every spelling of the head path, so a chunk keyed by any of them is found.
    files.add(fileDiff.file);
    for (const path of readHeaderPaths(fileDiff.patch, NEW_PATH_LINE)) {
      files.add(path);
      files.add(decodeGitPath(path));
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
  return (
    changes.sourceChanged.length > 0 ||
    movesPackageHost(changes) ||
    changesAlias(changes) ||
    addsNewHost(summary, context)
  );
}

/**
 * One summary per lockfile among `paths`, read from its contents in
 * `lockfiles`; a lockfile with no contents there reads as unavailable.
 */
export function summarizeLockfiles(
  paths: readonly string[],
  lockfiles: ReadonlyMap<string, LockfileSides> | undefined,
): Map<string, LockfileSummary> {
  const summaries = new Map<string, LockfileSummary>();
  for (const path of new Set(paths)) {
    const sides = lockfiles?.get(path) ?? UNAVAILABLE_SIDES;
    const summary = summarizeLockfile(path, sides);
    if (summary !== undefined) {
      summaries.set(path, summary);
    }
  }
  return summaries;
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
 * The pipeline owns `changes-package-source`: every chunk and unattributed
 * file loses it, then those in a pnpm, npm or yarn lockfile whose summary
 * fires the rule gain it, and those in a changed registry config file. A
 * lockfile with no summary fires.
 */
export function flagPackageSourceChanges<Chunk extends FiledChunk>(
  chunks: readonly Chunk[],
  unattributed: readonly UnattributedFile[],
  summaries: ReadonlyMap<string, LockfileSummary>,
  context: PackageSourceContext,
): PackageSourceFlags<Chunk> {
  const firesByPath = new Map<string, boolean>();
  function readFires(path: string): boolean {
    const known = firesByPath.get(path);
    if (known !== undefined) {
      return known;
    }
    const summary = summaries.get(path);
    const lockfileFires =
      isPackageLockfile(path) &&
      (summary === undefined || changesPackageSource(summary, context));
    const configFires =
      isRegistryConfigPath(path) || context.registryConfigFiles.has(path);
    const fires = lockfileFires || configFires;
    firesByPath.set(path, fires);
    return fires;
  }

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

  return { chunks: flaggedChunks, unattributed: flaggedFiles };
}
