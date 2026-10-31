import type { IndexedFile } from "../../diff/hunk-index/types";
import { changedRangesFromFileDiffs } from "../../diff/revchanges";
import { Concerns, Roles, ShortenedReadings, type Chunk } from "../../types";
import { readNpmLockfile } from "./lockfiles/npm";
import { readPnpmLockfile } from "./lockfiles/pnpm";
import {
  LockfileReadFailures,
  type LockfileEntry,
  type LockfileRead,
  type LockfileReadFailure,
  type PackageChanges,
  type PackageSourceChange,
  type PackageUpdate,
  type PackageVersion,
  type ReadLockfile,
} from "./lockfiles/types";
import { comparePackageEntries, isPackageName } from "./lockfiles/utils";
import { readYarnLockfile } from "./lockfiles/yarn";
import {
  LOCKFILE_FORMAT_BY_NAME,
  LOCKFILE_MAX_BYTES,
  SUMMARY_LINE_INDENT,
} from "./consts";
import {
  LockfileFormats,
  LockfileSideKinds,
  ShortenedKinds,
  type LinguistAttributes,
  type LockfileFormat,
  type LockfileSide,
  type LockfileSides,
  type LockfileSummary,
  type PackageLockfileFormat,
  type PackageLockfileSummary,
  type ShortenedChunkIds,
  type ShortenedFile,
  type ShortenedKind,
} from "./types";

export { LOCKFILE_MAX_BYTES } from "./consts";
export { LockfileReadFailures } from "./lockfiles/types";
export {
  LockfileFormats,
  LockfileSideKinds,
  type LockfileSide,
  type LockfileSides,
  type LockfileSummary,
} from "./types";

const VERSION_TOKEN = /^[^\s\p{Cc}]{1,1024}$/u;

const LOCKFILE_READERS: Record<PackageLockfileFormat, ReadLockfile> = {
  [LockfileFormats.PNPM]: readPnpmLockfile,
  [LockfileFormats.NPM]: readNpmLockfile,
  [LockfileFormats.YARN]: readYarnLockfile,
};

export function detectLockfile(path: string): LockfileFormat | undefined {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  return LOCKFILE_FORMAT_BY_NAME.get(fileName);
}

/** Why a side cannot be read, found without parsing it. */
function precheckSide(side: LockfileSide): LockfileReadFailure | undefined {
  if (side.kind === LockfileSideKinds.UNAVAILABLE) {
    return LockfileReadFailures.UNAVAILABLE;
  }
  const tooLarge =
    side.kind === LockfileSideKinds.TEXT &&
    Buffer.byteLength(side.text, "utf8") > LOCKFILE_MAX_BYTES;
  return tooLarge ? LockfileReadFailures.TOO_LARGE : undefined;
}

/** Every field a summary line renders holds one token, so no field can add a line. */
function isRenderableEntry(entry: LockfileEntry): boolean {
  const aliasRenders =
    entry.aliasOf === undefined || isPackageName(entry.aliasOf);
  const renderable =
    isPackageName(entry.name) &&
    VERSION_TOKEN.test(entry.version) &&
    aliasRenders;
  return renderable;
}

function readSide(
  format: PackageLockfileFormat,
  side: LockfileSide,
): LockfileRead {
  if (side.kind !== LockfileSideKinds.TEXT) {
    return { ok: true, value: [] };
  }
  try {
    const read = LOCKFILE_READERS[format](side.text);
    if (read.ok && !read.value.every(isRenderableEntry)) {
      return { ok: false, error: LockfileReadFailures.UNPARSEABLE };
    }
    return read;
  } catch {
    // A parser recursing past the stack on hostile nesting: unread, never thrown.
    return { ok: false, error: LockfileReadFailures.UNPARSEABLE };
  }
}

/**
 * What a lockfile changes between its full contents at base and head,
 * package by package for pnpm, npm and yarn. A side that cannot be read
 * leaves the summary unread, naming why. Another ecosystem's lockfile is
 * `other`; a file that is not a lockfile has no summary.
 */
export function summarizeLockfile(
  path: string,
  sides: LockfileSides,
): LockfileSummary | undefined {
  const format = detectLockfile(path);
  if (format === undefined) {
    return undefined;
  }
  if (format === LockfileFormats.OTHER) {
    return { format };
  }

  const precheck = precheckSide(sides.before) ?? precheckSide(sides.after);
  if (precheck !== undefined) {
    return { format, unread: precheck };
  }
  const before = readSide(format, sides.before);
  if (!before.ok) {
    return { format, unread: before.error };
  }
  const after = readSide(format, sides.after);
  if (!after.ok) {
    return { format, unread: after.error };
  }
  const changes = comparePackageEntries(before.value, after.value);
  const summary: PackageLockfileSummary = { format, changes };
  if (sides.before.kind !== LockfileSideKinds.ABSENT) {
    summary.baseHosts = listKnownHosts(before.value);
  }
  // A copy: a substring of the text pins the whole text while a summary lives.
  return structuredClone(summary);
}

/**
 * The summary of a lockfile whose read failed before its parsers ran, or
 * whose parse could not finish, naming why; `other` and no summary as
 * `summarizeLockfile` reads them.
 */
export function summarizeUnreadLockfile(
  path: string,
  failure: LockfileReadFailure,
): LockfileSummary | undefined {
  const format = detectLockfile(path);
  if (format === undefined) {
    return undefined;
  }
  if (format === LockfileFormats.OTHER) {
    return { format };
  }
  return { format, unread: failure };
}

function listKnownHosts(entries: readonly LockfileEntry[]): string[] {
  const hosts = new Set<string>();
  for (const { host } of entries) {
    if (host !== undefined) {
      hosts.add(host);
    }
  }
  return [...hosts].toSorted();
}

function formatPackage(pkg: PackageVersion): string {
  const named = `${pkg.name}@${pkg.version}`;
  return pkg.aliasOf === undefined
    ? named
    : `${named} (alias of ${pkg.aliasOf})`;
}

function renderHosts(hosts: readonly string[] | undefined): string {
  return hosts === undefined ? "unknown host" : hosts.join(" ");
}

function renderVersion(verb: string, pkg: PackageVersion): string {
  return `${verb} ${formatPackage(pkg)} (${renderHosts(pkg.hosts)})`;
}

/** What a change does to an npm alias; nothing when neither side is one. */
function renderAliasNote(
  from: string | undefined,
  to: string | undefined,
): string | undefined {
  if (from === to) {
    return to === undefined ? undefined : `alias of ${to}`;
  }
  if (from === undefined) {
    return `now alias of ${to}`;
  }
  if (to === undefined) {
    return `no longer alias of ${from}`;
  }
  return `alias of ${from} -> ${to}`;
}

/** A line, then its alias note and its host note, each in parentheses. */
function appendNotes(
  line: string,
  aliasNote: string | undefined,
  hostNote: string | undefined,
): string {
  const notes = [aliasNote, hostNote].filter((note) => note !== undefined);
  return [line, ...notes.map((note) => `(${note})`)].join(" ");
}

/** A source change line, naming both hosts when they differ. */
function renderSourceChange(change: PackageSourceChange): string {
  const line = `source changed ${change.name}@${change.version}`;
  const aliasNote = renderAliasNote(change.fromAliasOf, change.toAliasOf);
  const from = renderHosts(change.fromHosts);
  const to = renderHosts(change.toHosts);
  const hostNote = from === to ? from : `${from} -> ${to}`;
  return appendNotes(line, aliasNote, hostNote);
}

/** An update line, with its alias note and both hosts when they differ. */
function renderUpdate(update: PackageUpdate): string {
  const line = `updated ${update.name} ${update.from} -> ${update.to}`;
  const aliasNote = renderAliasNote(update.fromAliasOf, update.toAliasOf);
  const from = renderHosts(update.fromHosts);
  const to = renderHosts(update.toHosts);
  const hostNote = from === to ? undefined : `${from} -> ${to}`;
  return appendNotes(line, aliasNote, hostNote);
}

function renderPackageChanges(changes: PackageChanges): string[] {
  const lines = [
    ...changes.added.map((pkg) => renderVersion("added", pkg)),
    ...changes.removed.map((pkg) => renderVersion("removed", pkg)),
    ...changes.updated.map(renderUpdate),
    ...changes.sourceChanged.map(renderSourceChange),
  ];
  return lines.map((line) => `${SUMMARY_LINE_INDENT}${line}`);
}

function renderShortenedTitle(file: IndexedFile, kind: ShortenedKind): string {
  return `${file.path} (${file.status}, +${file.added} -${file.removed}, ${kind})`;
}

/** A title line with the file's status and counts, then one line per package change. */
export function renderLockfileSummary(
  file: IndexedFile,
  summary: LockfileSummary,
): string[] {
  const title = renderShortenedTitle(file, ShortenedKinds.LOCKFILE);
  if (summary.format === LockfileFormats.OTHER) {
    return [title];
  }
  if ("unread" in summary) {
    return [
      title,
      `${SUMMARY_LINE_INDENT}package changes not read: ${summary.unread}`,
    ];
  }

  const lines = renderPackageChanges(summary.changes);
  if (lines.length === 0) {
    return [title, `${SUMMARY_LINE_INDENT}no package changes`];
  }
  return [title, ...lines];
}

/**
 * How a multi-call run reads `file` when not in full. A lockfile, given the
 * summary `summarizeLockfile` reads for it, reads by its package changes
 * when they were read and by its counts alone otherwise; a file
 * `.gitattributes` marks generated or vendored reads by its counts alone. A
 * lockfile wins over the attributes, and absent attributes read as neither.
 * Nothing for a file read in full.
 */
export function shortenFile(
  file: IndexedFile,
  attributes: LinguistAttributes | undefined,
  lockfile: LockfileSummary | undefined,
): ShortenedFile | undefined {
  if (lockfile !== undefined) {
    const readAs =
      "changes" in lockfile
        ? ShortenedReadings.PACKAGE_SUMMARY
        : ShortenedReadings.COUNTS_ONLY;
    return { file, kind: ShortenedKinds.LOCKFILE, readAs, lockfile };
  }

  if (attributes?.generated === true) {
    const kind = ShortenedKinds.GENERATED;
    return { file, kind, readAs: ShortenedReadings.COUNTS_ONLY };
  }
  if (attributes?.vendored === true) {
    const kind = ShortenedKinds.VENDORED;
    return { file, kind, readAs: ShortenedReadings.COUNTS_ONLY };
  }
  return undefined;
}

/** The lines a multi-call prompt carries in place of the file's patch. */
export function renderShortenedFile(shortened: ShortenedFile): string[] {
  const { file, kind, lockfile } = shortened;
  if (lockfile !== undefined) {
    return renderLockfileSummary(file, lockfile);
  }

  const headers = file.hunks.flatMap((hunk) =>
    hunk.header === undefined ? [] : [`${SUMMARY_LINE_INDENT}${hunk.header}`],
  );
  return [renderShortenedTitle(file, kind), ...headers];
}

/**
 * The one chunk code writes for a shortened file: every changed line, concern
 * `generated`, role `supporting`, no risk attribute. The pipeline's own
 * attributes (`adds-secret`) are set later from the full patch.
 */
export function buildShortenedChunk(
  shortened: ShortenedFile,
  ids: ShortenedChunkIds,
): Chunk {
  const { file } = shortened;
  const patch = file.hunks
    .flatMap((hunk) =>
      hunk.header === undefined ? [] : [hunk.header, ...hunk.lines],
    )
    .join("\n");
  const [ranges] = changedRangesFromFileDiffs([{ file: file.path, patch }]);

  return {
    id: ids.id,
    changeGroupId: ids.changeGroupId,
    file: file.path,
    concern: Concerns.GENERATED,
    role: Roles.SUPPORTING,
    addedRanges: ranges?.addedRanges ?? [],
    removedRanges: ranges?.removedRanges ?? [],
    riskSurface: [],
    loc: { added: file.added, deleted: file.removed },
    readAs: shortened.readAs,
  };
}
