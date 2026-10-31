import {
  type LockfileEntry,
  type LockfileRead,
  type LockfileReadFailure,
  type PackageChanges,
  type PackageKey,
  type PackageSourceChange,
  type PackageUpdate,
  type PackageVersion,
} from "./types";

const PACKAGE_NAME = /^(?:@[\w~-][\w.~-]*\/)?[\w~-][\w.~-]*$/;
const PACKAGE_NAME_MAX_CHARS = 214;
const VERSION_COLLATOR = new Intl.Collator("en", { numeric: true });
// oxlint-disable-next-line no-control-regex -- control characters are the point
const AMBIGUOUS_URL_CHARACTER = /[\\\s\x00-\x1f\x7f]/;

/** The records of one package version: what they fetch and from which hosts. */
interface VersionRecords {
  sources: Set<string>;
  hosts: Set<string>;
  hostUnknown: boolean;
  aliases: Set<string>;
}

/** Versions to their records, per package name. */
type SourceIndex = Map<string, Map<string, VersionRecords>>;

/** The host of the configured registry, which a lockfile names only by omission. */
export const REGISTRY_HOST = "registry";
/** pnpm's directory resolution, which installs from disk. */
export const DIRECTORY_HOST = "directory:";
/** Berry's `workspace:` resolution, a project of this repository wherever its folder sits. */
export const WORKSPACE_HOST = "workspace:";
const HOST_SENTINELS: ReadonlySet<string> = new Set([
  REGISTRY_HOST,
  DIRECTORY_HOST,
  WORKSPACE_HOST,
]);

const GIT_PROTOCOL = /^git(?:\+[a-z]+)?:$/;
const GIT_PATH_SUFFIX = ".git";
/** Protocols on which `git@` is the transport's login, not a credential. */
const SSH_PROTOCOLS: ReadonlySet<string> = new Set(["ssh:", "git+ssh:"]);
const SSH_LOGIN = "git";
/** Stands in for the version wherever a URL spells it, so a bump keeps one identity. */
const VERSION_MARK = "{version}";
/** A directory left with this many segments still names an owner and a repository. */
const OWNER_REPO_SEGMENTS = 2;
/** Hosts whose paths start `/<owner>/<repo>/`, so a commit segment under them names no other package. */
const OWNER_REPO_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "codeload.github.com",
  "gitlab.com",
  "bitbucket.org",
]);

/** Where a registry serves `name@version`: `/<name>/-/<basename>-<version>.tgz`. */
function readRegistryTarballPath(pkg: PackageKey): string {
  const basename = pkg.name.slice(pkg.name.lastIndexOf("/") + 1);
  return `/${pkg.name}/-/${basename}-${pkg.version}.tgz`;
}

/** A version safe to mark: one a URL cannot read as a separator or a parameter. */
const MARKABLE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,1023}$/;
const ALPHANUMERIC = /[0-9A-Za-z]/;
const VERSION_PREFIX = "v";

/** Where `pattern` starts in `text`, by Knuth-Morris-Pratt so hostile text stays linear. */
function findOccurrences(text: string, pattern: string): number[] {
  const fallback = Array.from<number>({ length: pattern.length }).fill(0);
  for (let index = 1, matched = 0; index < pattern.length; index += 1) {
    while (matched > 0 && pattern[index] !== pattern[matched]) {
      matched = fallback[matched - 1] ?? 0;
    }
    if (pattern[index] === pattern[matched]) {
      matched += 1;
    }
    fallback[index] = matched;
  }

  const starts: number[] = [];
  for (let index = 0, matched = 0; index < text.length; index += 1) {
    while (matched > 0 && text[index] !== pattern[matched]) {
      matched = fallback[matched - 1] ?? 0;
    }
    if (text[index] === pattern[matched]) {
      matched += 1;
    }
    if (matched === pattern.length) {
      starts.push(index - matched + 1);
      matched = fallback[matched - 1] ?? 0;
    }
  }
  return starts;
}

function isAlphanumeric(char: string | undefined): boolean {
  return char !== undefined && ALPHANUMERIC.test(char);
}

/** Whether the token starting at `start` begins a word, a `v` prefix allowed. */
function startsToken(text: string, start: number): boolean {
  const before = text[start - 1];
  const prefixed =
    before === VERSION_PREFIX && !isAlphanumeric(text[start - 2]);
  const startsWord = !isAlphanumeric(before) || prefixed;
  return startsWord;
}

/**
 * `text` with each whole-token `version` marked; unchanged for a version
 * shaped otherwise, which then stays in the identity and a bump fires.
 */
function markVersion(text: string, version: string): string {
  if (!MARKABLE_VERSION.test(version)) {
    return text;
  }
  let marked = "";
  let copied = 0;
  for (const start of findOccurrences(text, version)) {
    const end = start + version.length;
    const whole = startsToken(text, start) && !isAlphanumeric(text[end]);
    if (start >= copied && whole) {
      marked += `${text.slice(copied, start)}${VERSION_MARK}`;
      copied = end;
    }
  }
  return `${marked}${text.slice(copied)}`;
}

/**
 * The part of a URL's path that names what it fetches, the version marked
 * wherever a segment spells it. On an owner/repo host a final segment that
 * spells no version (a commit) drops out while an owner and a repository
 * remain before it. Anywhere else the whole path stays, so another artifact
 * name on the same host is another identity.
 */
function readArtifactPath(
  host: string,
  pathname: string,
  version: string,
): string {
  const directoryEnd = pathname.lastIndexOf("/") + 1;
  const finalSegment = pathname.slice(directoryEnd);
  const directory = pathname.slice(0, directoryEnd);
  const segments = directory.split("/").filter((segment) => segment !== "");
  const dropsCommit =
    OWNER_REPO_HOSTS.has(host) &&
    segments.length >= OWNER_REPO_SEGMENTS &&
    markVersion(finalSegment, version) === finalSegment;
  return markVersion(dropsCommit ? directory : pathname, version);
}

/** Whether a URL carries a credential: any password, or a login other than ssh's `git`. */
function isCredentialed(url: URL): boolean {
  const sshLogin =
    url.username === SSH_LOGIN && SSH_PROTOCOLS.has(url.protocol);
  const namesLogin = url.username !== "" && !sshLogin;
  const hasCredential = url.password !== "" || namesLogin;
  return hasCredential;
}

/** A URL's protocol and host, or its protocol alone when it has no host. */
function readUrlOrigin(url: URL): string {
  return url.host === "" ? url.protocol : `${url.protocol}//${url.host}`;
}

/**
 * What a fetch spec points at, as one comparable string. `pkg`'s own
 * registry tarball reads as protocol and host. A git repository reads as
 * protocol, host and repository path; any other URL as protocol, host, the
 * path that names the artifact and the query, with the version marked.
 * Nothing when it cannot be read one way, which fails closed downstream.
 */
export function readFetchIdentity(
  spec: string,
  pkg: PackageKey,
  repository = false,
): string | undefined {
  // WHATWG rewrites `\\` and drops whitespace that git and curl read
  // otherwise, and userinfo can move the host another parser sees.
  if (AMBIGUOUS_URL_CHARACTER.test(spec)) {
    return undefined;
  }
  const url = URL.parse(spec);
  if (url === null || isCredentialed(url)) {
    return undefined;
  }
  // A URL host spelled like a sentinel would read as the configured registry.
  if (HOST_SENTINELS.has(url.host) || HOST_SENTINELS.has(url.protocol)) {
    return undefined;
  }
  const origin = readUrlOrigin(url);
  if (url.host !== "" && url.pathname === readRegistryTarballPath(pkg)) {
    return origin;
  }

  const isRepository =
    repository ||
    GIT_PROTOCOL.test(url.protocol) ||
    url.pathname.endsWith(GIT_PATH_SUFFIX);
  const path = isRepository
    ? url.pathname
    : readArtifactPath(url.host, url.pathname, pkg.version);
  return `${origin}${path}${markVersion(url.search, pkg.version)}`;
}

export function failRead(failure: LockfileReadFailure): LockfileRead {
  return { ok: false, error: failure };
}

/** A plain semver version: no range, URL or path a fetcher could read otherwise. */
const PLAIN_SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PLAIN_SEMVER_MAX_CHARS = 256;

export function isPlainSemver(version: string): boolean {
  return version.length <= PLAIN_SEMVER_MAX_CHARS && PLAIN_SEMVER.test(version);
}

export function isPackageName(name: string): boolean {
  return name.length <= PACKAGE_NAME_MAX_CHARS && PACKAGE_NAME.test(name);
}

/** Splits `name@version` (scoped names keep their leading `@`). */
export function splitPackageKey(key: string): PackageKey | undefined {
  const at = key.indexOf("@", 1);
  if (at === -1) {
    return undefined;
  }
  const name = key.slice(0, at);
  const version = key.slice(at + 1);
  if (version === "" || !isPackageName(name)) {
    return undefined;
  }
  return { name, version };
}

/** JSON with object keys sorted at every depth, so equal values compare equal. */
export function stringifySorted(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    const isPlainObject =
      typeof inner === "object" && inner !== null && !Array.isArray(inner);
    if (!isPlainObject) {
      return inner;
    }
    const sorted = Object.entries(inner).toSorted(([left], [right]) =>
      left.localeCompare(right),
    );
    return Object.fromEntries(sorted);
  });
}

function indexSources(entries: readonly LockfileEntry[]): SourceIndex {
  const index: SourceIndex = new Map();
  for (const { name, version, source, host, aliasOf } of entries) {
    const versions = index.get(name) ?? new Map<string, VersionRecords>();
    const records = versions.get(version) ?? {
      sources: new Set<string>(),
      hosts: new Set<string>(),
      hostUnknown: false,
      aliases: new Set<string>(),
    };
    records.sources.add(source);
    if (aliasOf !== undefined) {
      records.aliases.add(aliasOf);
    }
    if (host === undefined) {
      records.hostUnknown = true;
    } else {
      records.hosts.add(host);
    }
    versions.set(version, records);
    index.set(name, versions);
  }
  return index;
}

function listHosts(records: VersionRecords): string[] | undefined {
  return records.hostUnknown ? undefined : [...records.hosts].toSorted();
}

function toPackageVersion(
  name: string,
  version: string,
  records: VersionRecords,
): PackageVersion {
  const pkg: PackageVersion = { name, version };
  const hosts = listHosts(records);
  if (hosts !== undefined) {
    pkg.hosts = hosts;
  }
  const aliasOf = listAliases(records);
  if (aliasOf !== undefined) {
    pkg.aliasOf = aliasOf;
  }
  return pkg;
}

function listAliases(records: VersionRecords): string | undefined {
  return records.aliases.size === 0
    ? undefined
    : [...records.aliases].toSorted().join(", ");
}

function toSourceChange(
  name: string,
  version: string,
  previous: VersionRecords,
  records: VersionRecords,
): PackageSourceChange {
  const change: PackageSourceChange = { name, version };
  const fromHosts = listHosts(previous);
  if (fromHosts !== undefined) {
    change.fromHosts = fromHosts;
  }
  const toHosts = listHosts(records);
  if (toHosts !== undefined) {
    change.toHosts = toHosts;
  }
  const fromAliasOf = listAliases(previous);
  if (fromAliasOf !== undefined) {
    change.fromAliasOf = fromAliasOf;
  }
  const toAliasOf = listAliases(records);
  if (toAliasOf !== undefined) {
    change.toAliasOf = toAliasOf;
  }
  return change;
}

function isSameSourceSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  const sameSet =
    left.size === right.size && [...left].every((source) => right.has(source));
  return sameSet;
}

function compareVersions(left: string, right: string): number {
  return VERSION_COLLATOR.compare(left, right);
}

function comparePackages(left: PackageKey, right: PackageKey): number {
  return (
    left.name.localeCompare(right.name) ||
    compareVersions(left.version, right.version)
  );
}

function compareUpdates(left: PackageUpdate, right: PackageUpdate): number {
  return (
    left.name.localeCompare(right.name) ||
    compareVersions(left.from, right.from)
  );
}

function toPackageUpdate(
  from: PackageVersion,
  to: PackageVersion,
): PackageUpdate {
  const update: PackageUpdate = {
    name: from.name,
    from: from.version,
    to: to.version,
  };
  if (from.hosts !== undefined) {
    update.fromHosts = from.hosts;
  }
  if (to.hosts !== undefined) {
    update.toHosts = to.hosts;
  }
  if (from.aliasOf !== undefined) {
    update.fromAliasOf = from.aliasOf;
  }
  if (to.aliasOf !== undefined) {
    update.toAliasOf = to.aliasOf;
  }
  return update;
}

/** A dropped and an added version of one package read as updates when the two sides list as many. */
function pairVersions(
  removed: readonly PackageVersion[],
  added: readonly PackageVersion[],
  changes: PackageChanges,
): void {
  if (removed.length !== added.length) {
    // A loop, not `push(...list)`: one name can carry more versions than a call takes arguments.
    for (const pkg of removed) {
      changes.removed.push(pkg);
    }
    for (const pkg of added) {
      changes.added.push(pkg);
    }
    return;
  }
  const from = removed.toSorted(comparePackages);
  const to = added.toSorted(comparePackages);
  for (const [position, previous] of from.entries()) {
    const next = to[position];
    if (next !== undefined) {
      changes.updated.push(toPackageUpdate(previous, next));
    }
  }
}

function compareOnePackage(
  name: string,
  before: ReadonlyMap<string, VersionRecords>,
  after: ReadonlyMap<string, VersionRecords>,
  changes: PackageChanges,
): void {
  const added: PackageVersion[] = [];
  for (const [version, records] of after) {
    const previous = before.get(version);
    if (previous === undefined) {
      added.push(toPackageVersion(name, version, records));
    } else if (!isSameSourceSet(previous.sources, records.sources)) {
      changes.sourceChanged.push(
        toSourceChange(name, version, previous, records),
      );
    }
  }
  const removed = [...before]
    .filter(([version]) => !after.has(version))
    .map(([version, records]) => toPackageVersion(name, version, records));
  pairVersions(removed, added, changes);
}

/**
 * Package changes between two full reads of one lockfile. Each package
 * version is compared by its whole set of sources, so a second record of the
 * same version from another source (a shadow entry) is a source change.
 */
export function comparePackageEntries(
  before: readonly LockfileEntry[],
  after: readonly LockfileEntry[],
): PackageChanges {
  const beforeIndex = indexSources(before);
  const afterIndex = indexSources(after);
  const changes: PackageChanges = {
    added: [],
    removed: [],
    updated: [],
    sourceChanged: [],
  };
  const names = new Set([...beforeIndex.keys(), ...afterIndex.keys()]);
  for (const name of names) {
    const beforeVersions =
      beforeIndex.get(name) ?? new Map<string, VersionRecords>();
    const afterVersions =
      afterIndex.get(name) ?? new Map<string, VersionRecords>();
    compareOnePackage(name, beforeVersions, afterVersions, changes);
  }

  return {
    added: changes.added.toSorted(comparePackages),
    removed: changes.removed.toSorted(comparePackages),
    updated: changes.updated.toSorted(compareUpdates),
    sourceChanged: changes.sourceChanged.toSorted(comparePackages),
  };
}
