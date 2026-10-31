import type { IndexedFile } from "../../diff/hunk-index/types";
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
  type LockfileFormat,
  type LockfileSide,
  type LockfileSides,
  type LockfileSummary,
  type PackageLockfileFormat,
  type PackageLockfileSummary,
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
  return summary;
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

/** A title line with the file's status and counts, then one line per package change. */
export function renderLockfileSummary(
  file: IndexedFile,
  summary: LockfileSummary,
): string[] {
  const title = `${file.path} (${file.status}, +${file.added} -${file.removed}, lockfile)`;
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
