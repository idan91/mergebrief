import { z } from "zod/v4";
import type { Result } from "types/utils";
import {
  LockfileReadFailures,
  type LockfileEntry,
  type LockfileRead,
  type LockfileReadFailure,
  type PackageKey,
} from "./types";
import {
  failRead,
  isPackageName,
  readFetchIdentity,
  DIRECTORY_HOST,
  REGISTRY_HOST,
  splitPackageKey,
  stringifySorted,
} from "./utils";
import { readYamlLockfile, type YamlLockfileShape } from "./yaml";

const PnpmPackageSchema = z.object({
  resolution: z.unknown().optional(),
  name: z.string().optional(),
  version: z.string().optional(),
});

const PACKAGES_KEY = "packages";

/** The resolution shapes pnpm writes, each fetched from the field noted. */
const RegistryResolutionSchema = z.strictObject({ integrity: z.string() });
const TarballResolutionSchema = z.strictObject({
  tarball: z.string(),
  integrity: z.string().optional(),
  path: z.string().optional(),
  gitHosted: z.string().optional(),
});
const GitResolutionSchema = z.strictObject({
  type: z.literal("git"),
  repo: z.string(),
  commit: z.string(),
  path: z.string().optional(),
});
const DirectoryResolutionSchema = z.strictObject({
  type: z.literal("directory"),
  directory: z.string(),
});
/** pnpm's binary fetcher downloads `url`; the rest of the shape does not move it. */
const BinaryResolutionSchema = z.object({
  type: z.literal("binary"),
  url: z.string(),
});

/**
 * Where pnpm fetches a resolution from, read by its `type` as pnpm picks its
 * fetcher; an integrity alone means the configured registry. Any other shape
 * has no known host, which fails closed downstream.
 */
function readResolutionHost(
  resolution: unknown,
  pkg: PackageKey,
): string | undefined {
  if (RegistryResolutionSchema.safeParse(resolution).success) {
    return REGISTRY_HOST;
  }
  const tarball = TarballResolutionSchema.safeParse(resolution);
  if (tarball.success) {
    return readFetchIdentity(tarball.data.tarball, pkg);
  }
  const git = GitResolutionSchema.safeParse(resolution);
  if (git.success) {
    return readFetchIdentity(git.data.repo, pkg, true);
  }
  if (DirectoryResolutionSchema.safeParse(resolution).success) {
    return DIRECTORY_HOST;
  }
  const binary = BinaryResolutionSchema.safeParse(resolution);
  return binary.success ? readFetchIdentity(binary.data.url, pkg) : undefined;
}

type PnpmPackage = z.infer<typeof PnpmPackageSchema>;

/** An empty section reads as "" under the failsafe schema. */
const PnpmSectionsSchema = z.object({
  packages: z
    .union([z.record(z.string(), PnpmPackageSchema), z.literal("")])
    .optional(),
  snapshots: z
    .union([z.record(z.string(), z.unknown()), z.literal("")])
    .optional(),
  lockfileVersion: z.string().optional(),
});
const SNAPSHOTS_KEY = "snapshots";
const LOCKFILE_VERSION_KEY = "lockfileVersion";
/** Every top-level key pnpm 5 through 10 writes, single-project and workspace forms included. */
const PNPM_TOP_KEYS: ReadonlySet<string> = new Set([
  LOCKFILE_VERSION_KEY,
  PACKAGES_KEY,
  SNAPSHOTS_KEY,
  "settings",
  "importers",
  "catalogs",
  "overrides",
  "packageExtensionsChecksum",
  "pnpmfileChecksum",
  "patchedDependencies",
  "time",
  "ignoredOptionalDependencies",
  "onlyBuiltDependencies",
  "neverBuiltDependencies",
  "onlyBuiltDependenciesFile",
  "configDependencies",
  "packageManagerDependencies",
  "specifiers",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "dependenciesMeta",
  "publishDirectory",
]);
/** pnpm 10 writes the lockfile of its own install and config dependencies as a first document. */
const PNPM_SHAPE: YamlLockfileShape = {
  maxDocuments: 2,
  isTopKey: (key) => PNPM_TOP_KEYS.has(key),
  sections: [PACKAGES_KEY, SNAPSHOTS_KEY, LOCKFILE_VERSION_KEY],
};
/** pnpm 8 ignores `snapshots:`; only a v9 lockfile installs from it. */
const SNAPSHOT_LOCKFILE_VERSION = /^9(?:\.|$)/;
/** Fields pnpm takes from `packages:` over the snapshot; a snapshot setting one is ambiguous. */
const PACKAGE_ONLY_FIELDS = ["resolution", "name", "version"];
const V5_PEERS_SEPARATOR = "_";

/**
 * A key less its trailing balanced `(...)` peer groups, cut where pnpm's own
 * `removeSuffix` cuts: nothing unless the key ends in `)`.
 */
function removePeersSuffix(key: string): string {
  if (!key.endsWith(")")) {
    return key;
  }
  let open = 0;
  for (let index = key.length - 1; index >= 0; index -= 1) {
    const char = key[index];
    if (char === ")") {
      open += 1;
    } else if (char === "(") {
      open -= 1;
    } else if (open === 0) {
      return key.slice(0, index + 1);
    }
  }
  return key;
}

/**
 * The name and version spec of a `packages:` key: `name@1.2.3` (v9),
 * `/name@1.2.3(peer@1)` (v6) or `/name/1.2.3_peer@1` (v5). A non-registry
 * spec (a URL, `file:`, `git+`) stays as written.
 */
function parsePackageKey(key: string): PackageKey | undefined {
  const unslashed = key.startsWith("/") ? key.slice(1) : key;
  const bare = removePeersSuffix(unslashed);
  if (bare.includes("(")) {
    return undefined;
  }
  const atForm = splitPackageKey(bare);
  if (atForm !== undefined) {
    return atForm;
  }
  const slash = bare.lastIndexOf("/");
  const name = bare.slice(0, slash);
  // v5 appends resolved peers after `_`, which no semver version holds.
  const peersStart = bare.indexOf(V5_PEERS_SEPARATOR, slash + 1);
  const version = bare.slice(
    slash + 1,
    peersStart === -1 ? undefined : peersStart,
  );
  const slashForm = slash > 0 && version !== "" && isPackageName(name);
  return slashForm ? { name, version } : undefined;
}

/** A resolution that names where it fetches from, not one pnpm derives from the key. */
const LocatedResolutionSchema = z.union([
  TarballResolutionSchema,
  GitResolutionSchema,
  DirectoryResolutionSchema,
  BinaryResolutionSchema,
]);

/**
 * A v5 or v6 key for a git, tarball or `file:` package (`github.com/o/r/sha`,
 * `file:packages/foo`) carries no name; pnpm reads it from the record, and
 * the key stands as the spec. Only a resolution that names its own location
 * qualifies: for an integrity-only one pnpm fetches what the key names.
 */
function readNonRegistryKey(
  key: string,
  record: PnpmPackage,
): PackageKey | undefined {
  const { name, version } = record;
  const located = LocatedResolutionSchema.safeParse(record.resolution).success;
  const named = name !== undefined && version !== undefined;
  const readable = located && named && isPackageName(name);
  return readable ? { name, version: key } : undefined;
}

function toPackageEntry(
  key: string,
  record: PnpmPackage,
  snapshotFormat: boolean,
): Result<LockfileEntry, LockfileReadFailure> {
  const keyed = parsePackageKey(key);
  const packageKey =
    keyed ?? (snapshotFormat ? undefined : readNonRegistryKey(key, record));
  if (packageKey === undefined) {
    return { ok: false, error: LockfileReadFailures.UNPARSEABLE };
  }
  // pnpm installs by the key's name; a record naming another is ambiguous.
  const { name } = packageKey;
  if (record.name !== undefined && record.name !== name) {
    return { ok: false, error: LockfileReadFailures.AMBIGUOUS };
  }
  const version = record.version ?? packageKey.version;
  const resolution = stringifySorted(record.resolution ?? null);
  const source =
    version === packageKey.version
      ? resolution
      : `${resolution} ${packageKey.version}`;
  const entry: LockfileEntry = { name, version, source };
  const host = readResolutionHost(record.resolution, { name, version });
  if (host !== undefined) {
    entry.host = host;
  }
  return { ok: true, value: entry };
}

/**
 * The `packages:` keys pnpm installs. Without `snapshots:` (v5, v6) that is
 * every key; with it (v9) each snapshot's key less its peer suffix, which
 * must name a package and carry no fields pnpm reads only from `packages:`.
 * pnpm writes no `packages:` key without a snapshot, so one reads ambiguous.
 */
function listInstalledKeys(
  packages: Record<string, PnpmPackage>,
  snapshots: Record<string, unknown> | undefined,
): Result<string[], LockfileReadFailure> {
  if (snapshots === undefined) {
    return { ok: true, value: Object.keys(packages) };
  }
  const keys = new Set<string>();
  for (const [key, snapshot] of Object.entries(snapshots)) {
    const packageKey = removePeersSuffix(key);
    const overrides =
      typeof snapshot === "object" &&
      snapshot !== null &&
      PACKAGE_ONLY_FIELDS.some((field) => Object.hasOwn(snapshot, field));
    const ambiguous =
      overrides ||
      packageKey.includes("(") ||
      !Object.hasOwn(packages, packageKey);
    if (ambiguous) {
      return { ok: false, error: LockfileReadFailures.AMBIGUOUS };
    }
    keys.add(packageKey);
  }
  if (keys.size !== Object.keys(packages).length) {
    return { ok: false, error: LockfileReadFailures.AMBIGUOUS };
  }
  return { ok: true, value: [...keys] };
}

function readPnpmDocument(value: unknown): LockfileRead {
  const parsed = PnpmSectionsSchema.safeParse(value);
  if (!parsed.success) {
    return failRead(LockfileReadFailures.UNPARSEABLE);
  }
  const packages = parsed.data.packages || {};
  const snapshots = parsed.data.snapshots || undefined;
  const snapshotFormat = SNAPSHOT_LOCKFILE_VERSION.test(
    parsed.data.lockfileVersion ?? "",
  );
  if (snapshots !== undefined && !snapshotFormat) {
    return failRead(LockfileReadFailures.AMBIGUOUS);
  }
  const installed = listInstalledKeys(packages, snapshots);
  if (!installed.ok) {
    return failRead(installed.error);
  }

  const entries: LockfileEntry[] = [];
  for (const key of installed.value) {
    const record = packages[key];
    const entry =
      record === undefined
        ? undefined
        : toPackageEntry(key, record, snapshotFormat);
    if (entry === undefined || !entry.ok) {
      return failRead(entry?.error ?? LockfileReadFailures.AMBIGUOUS);
    }
    entries.push(entry.value);
  }
  return { ok: true, value: entries };
}

/**
 * Every package record a pnpm lockfile installs, v5 through v9, across
 * both documents pnpm 10 writes. A record keyed by a non-registry spec
 * takes its real version from its `version:` field, and the spec joins its
 * source.
 */
export function readPnpmLockfile(text: string): LockfileRead {
  const read = readYamlLockfile(text, PNPM_SHAPE);
  if (!read.ok) {
    return failRead(read.error);
  }
  const entries: LockfileEntry[] = [];
  for (const document of read.value) {
    const documentEntries = readPnpmDocument(document);
    if (!documentEntries.ok) {
      return documentEntries;
    }
    // A loop, not `push(...list)`: a document can hold more entries than a call takes arguments.
    for (const entry of documentEntries.value) {
      entries.push(entry);
    }
  }
  return { ok: true, value: entries };
}
