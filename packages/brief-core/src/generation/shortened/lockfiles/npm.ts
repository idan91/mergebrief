import { z } from "zod/v4";
import {
  LockfileReadFailures,
  type LockfileEntry,
  type LockfileRead,
  type PackageKey,
} from "./types";
import {
  failRead,
  isPackageName,
  isPlainSemver,
  readFetchIdentity,
} from "./utils";

const NODE_MODULES = "node_modules/";
const NESTED_NODE_MODULES = `/${NODE_MODULES}`;

const NpmPackageSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  resolved: z.string().optional(),
  integrity: z.string().optional(),
  link: z.boolean().optional(),
  inBundle: z.boolean().optional(),
  /** Read leniently: anything but a list of names lists nothing. */
  bundleDependencies: z.unknown().optional(),
});

interface NpmV1Dependency {
  version?: string | undefined;
  resolved?: string | undefined;
  /** npm 6 installs from `from` over `version` when no `resolved` names a source. */
  from?: string | undefined;
  integrity?: string | undefined;
  bundled?: boolean | undefined;
  dependencies?: Record<string, NpmV1Dependency> | undefined;
}

const NpmV1DependencySchema: z.ZodType<NpmV1Dependency> = z.lazy(() =>
  z.object({
    version: z.string().optional(),
    resolved: z.string().optional(),
    from: z.string().optional(),
    integrity: z.string().optional(),
    bundled: z.boolean().optional(),
    dependencies: z.record(z.string(), NpmV1DependencySchema).optional(),
  }),
);

const NpmLockfileSchema = z.object({
  packages: z.record(z.string(), NpmPackageSchema).optional(),
  dependencies: z.record(z.string(), NpmV1DependencySchema).optional(),
});

interface ObjectFrame {
  keys: Set<string>;
  expectsKey: boolean;
}

/** Where the string token opening at `start` closes, past its closing quote. */
function findStringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') {
    index += text[index] === "\\" ? 2 : 1;
  }
  return index + 1;
}

function readObjectKey(
  frame: ObjectFrame,
  token: string,
): "duplicate" | "fresh" | "malformed" {
  try {
    const key: unknown = JSON.parse(token);
    if (typeof key !== "string") {
      return "malformed";
    }
    if (frame.keys.has(key)) {
      return "duplicate";
    }
    frame.keys.add(key);
    frame.expectsKey = false;
    return "fresh";
  } catch {
    return "malformed";
  }
}

/**
 * Whether any JSON object repeats a key, compared after unescaping. JSON.parse
 * keeps the last value, so a repeated key could hide a second source.
 */
function holdsDuplicateKey(text: string): boolean {
  const frames: (ObjectFrame | undefined)[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const frame = frames.at(-1);
    if (char === '"') {
      const end = findStringEnd(text, index);
      const isKey = frame !== undefined && frame.expectsKey;
      if (isKey && readObjectKey(frame, text.slice(index, end)) !== "fresh") {
        return true;
      }
      index = end;
      continue;
    }
    if (char === "{") {
      frames.push({ keys: new Set(), expectsKey: true });
    } else if (char === "[") {
      frames.push(undefined);
    } else if (char === "}" || char === "]") {
      frames.pop();
    } else if (char === "," && frame !== undefined) {
      frame.expectsKey = true;
    }
    index += 1;
  }
  return false;
}

interface NpmSourceFields {
  resolved?: string | undefined;
  integrity?: string | undefined;
  bundled?: boolean | undefined;
}

function readSource(
  record: NpmSourceFields,
  aliasOf: string | undefined,
): string {
  const source = `${record.resolved ?? ""} ${record.integrity ?? ""}`;
  return aliasOf === undefined ? source : `${source} alias:${aliasOf}`;
}

/**
 * One record. A bundled one without `resolved` ships inside its parent's
 * tarball, so it reads as fetched from the parent's host.
 */
function toEntry(
  name: string,
  version: string,
  record: NpmSourceFields,
  parentHost: string | undefined,
  aliasOf?: string,
): LockfileEntry {
  const source = readSource(record, aliasOf);
  const entry: LockfileEntry = { name, version, source };
  if (aliasOf !== undefined) {
    entry.aliasOf = aliasOf;
  }
  // An alias fetches its target's tarball.
  const fetched = { name: aliasOf ?? name, version };
  // npm fetches a bundled record's own `resolved` when the parent's tarball lacks it.
  const fromParent = record.bundled === true && record.resolved === undefined;
  const host = fromParent
    ? parentHost
    : readResolvedHost(record.resolved, fetched);
  if (host !== undefined) {
    entry.host = host;
  }
  return entry;
}

function readResolvedHost(
  resolved: string | undefined,
  pkg: PackageKey,
): string | undefined {
  return resolved === undefined ? undefined : readFetchIdentity(resolved, pkg);
}

/** A read record as a parent of the folders nested under it. */
interface BundlingParent {
  host: string | undefined;
  bundles: ReadonlySet<string>;
}

function listBundledNames(bundleDependencies: unknown): ReadonlySet<string> {
  if (!Array.isArray(bundleDependencies)) {
    return new Set();
  }
  return new Set(
    bundleDependencies.filter(
      (name): name is string => typeof name === "string",
    ),
  );
}

/**
 * The host of the record whose tarball bundles `name` at `path`: its
 * parent folder's record, when that record lists `name` in
 * `bundleDependencies`. Any other bundled record has no known host.
 */
function readBundleHost(
  path: string,
  name: string,
  parents: ReadonlyMap<string, BundlingParent>,
): string | undefined {
  const parentEnd = path.lastIndexOf(NESTED_NODE_MODULES);
  const parent =
    parentEnd === -1 ? undefined : parents.get(path.slice(0, parentEnd));
  return parent?.bundles.has(name) ? parent.host : undefined;
}

/**
 * The installed `node_modules/` records. npm fetches a record without a
 * version by its `resolved`, so only a symlink may omit one. npm sorts the
 * paths, so a bundling parent is read before what it bundles. A bundled
 * record reads as fetched from its parent's host only when the parent
 * lists it in `bundleDependencies` and it names a plain semver version.
 */
function readPackages(
  packages: Record<string, z.infer<typeof NpmPackageSchema>>,
): LockfileRead {
  const entries: LockfileEntry[] = [];
  const parents = new Map<string, BundlingParent>();
  for (const [path, record] of Object.entries(packages)) {
    const start = path.lastIndexOf(NODE_MODULES);
    if (start === -1 || record.link === true) {
      continue;
    }
    if (record.version === undefined) {
      return failRead(LockfileReadFailures.AMBIGUOUS);
    }
    // npm installs by the folder; a record naming another package is an alias of it.
    const name = path.slice(start + NODE_MODULES.length);
    const aliased = record.name !== undefined && record.name !== name;
    const aliasOf = aliased ? record.name : undefined;
    const fields = { ...record, bundled: record.inBundle };
    const inheritable =
      record.inBundle === true && isPlainSemver(record.version);
    const parentHost = inheritable
      ? readBundleHost(path, name, parents)
      : undefined;
    const entry = toEntry(name, record.version, fields, parentHost, aliasOf);
    parents.set(path, {
      host: entry.host,
      bundles: listBundledNames(record.bundleDependencies),
    });
    entries.push(entry);
  }
  return { ok: true, value: entries };
}

interface V1Level {
  tree: Record<string, NpmV1Dependency>;
  parentHost: string | undefined;
  /** The install path of this level's records, as `packages:` keys them. */
  pathPrefix: string;
}

/** The version npm writes in the v1 tree of a v2 file for a symlinked folder, as a workspace. */
const LINK_VERSION_PREFIX = "file:";

/** The version an npm 6 tree writes for an alias: `npm:<name>@<version>`. */
const NPM_ALIAS_VERSION = /^npm:((?:@[^@/]+\/)?[^@/]+)@(.+)$/;

interface V1Record {
  version: string;
  aliasOf?: string;
  fields: NpmSourceFields;
}

/**
 * A tree record as npm 6 installs it. An alias names its target in the
 * version, as `packages:` does in `name`; a URL or git spec there is what
 * npm fetches when no `resolved` names another source.
 */
function readV1Record(version: string, record: NpmV1Dependency): V1Record {
  const alias = NPM_ALIAS_VERSION.exec(version);
  const [, aliasOf, aliasVersion] = alias ?? [];
  if (aliasOf !== undefined && aliasVersion !== undefined) {
    return { version: aliasVersion, aliasOf, fields: record };
  }
  const spec = URL.parse(version);
  const fetchesSpec =
    record.resolved === undefined && spec !== null && spec.host !== "";
  const fields = fetchesSpec ? { ...record, resolved: version } : record;
  return { version, fields };
}

/** npm 6's own tarball test, its unescaped `tar.gz` dot kept: a folder link never names one. */
const TARBALL_EXTENSION = /[.](?:tgz|tar.gz|tar)$/i;
/** npm 6 resolves a `~/` spec under the user's home, outside the repository. */
const HOME_PREFIX = "~";
/** A drive letter, an authority or a Windows separator, none of which a repo-relative folder holds. */
const UNSAFE_FOLDER_CHARACTER = /[\\:]/;

/** A relative folder inside the repository: no root, home, authority, dot segment or tarball. */
function isRepoFolder(target: string): boolean {
  const segments = target.split("/");
  const leavesRepo = segments.some(
    (segment) => segment === "" || segment === "." || segment === "..",
  );
  const unsafe =
    leavesRepo ||
    target.startsWith(HOME_PREFIX) ||
    UNSAFE_FOLDER_CHARACTER.test(target) ||
    TARBALL_EXTENSION.test(target);
  return !unsafe;
}

/**
 * Each install path `packages:` links to a repo folder holding its own
 * `packages:` record, as a workspace, to that folder.
 */
function listLinkedFolders(
  packages: Record<string, z.infer<typeof NpmPackageSchema>>,
): Map<string, string> {
  const linked = new Map<string, string>();
  for (const [path, record] of Object.entries(packages)) {
    const target = record.resolved;
    const linksFolder =
      record.link === true &&
      target !== undefined &&
      isRepoFolder(target) &&
      Object.hasOwn(packages, target);
    if (linksFolder) {
      linked.set(path, target);
    }
  }
  return linked;
}

/**
 * The v1 record npm writes for a workspace `packages:` links: `file:` and
 * that same folder, with nothing else naming a source. npm 6 links the
 * folder and fetches nothing, so it is skipped as `packages:` skips the link.
 */
function isFolderLink(
  path: string,
  record: NpmV1Dependency,
  linkedFolders: ReadonlyMap<string, string>,
): boolean {
  const target = linkedFolders.get(path);
  const namesOnlyFolder =
    target !== undefined &&
    record.version === `${LINK_VERSION_PREFIX}${target}` &&
    record.resolved === undefined &&
    record.from === undefined;
  return namesOnlyFolder;
}

function readV1Entry(
  name: string,
  version: string,
  record: NpmV1Dependency,
  levelHost: string | undefined,
): LockfileEntry {
  const read = readV1Record(version, record);
  const inheritable = record.bundled === true && isPlainSemver(read.version);
  const parentHost = inheritable ? levelHost : undefined;
  return toEntry(name, read.version, read.fields, parentHost, read.aliasOf);
}

/** The nested lockfile v1 tree, walked without recursion so depth cannot overflow the stack. */
function readV1Dependencies(
  root: Record<string, NpmV1Dependency>,
  linkedFolders: ReadonlyMap<string, string>,
): LockfileRead {
  const entries: LockfileEntry[] = [];
  const pending: V1Level[] = [
    { tree: root, parentHost: undefined, pathPrefix: NODE_MODULES },
  ];
  for (let level = pending.pop(); level !== undefined; level = pending.pop()) {
    for (const [name, record] of Object.entries(level.tree)) {
      if (!isPackageName(name)) {
        return failRead(LockfileReadFailures.UNPARSEABLE);
      }
      if (record.version === undefined) {
        return failRead(LockfileReadFailures.AMBIGUOUS);
      }
      const path = `${level.pathPrefix}${name}`;
      const entry = isFolderLink(path, record, linkedFolders)
        ? undefined
        : readV1Entry(name, record.version, record, level.parentHost);
      if (entry !== undefined) {
        entries.push(entry);
      }
      if (record.dependencies !== undefined) {
        pending.push({
          tree: record.dependencies,
          parentHost: entry?.host,
          pathPrefix: `${path}${NESTED_NODE_MODULES}`,
        });
      }
    }
  }
  return { ok: true, value: entries };
}

/** Every installed package of a package-lock or shrinkwrap, v1 through v3. */
export function readNpmLockfile(text: string): LockfileRead {
  if (holdsDuplicateKey(text)) {
    return failRead(LockfileReadFailures.AMBIGUOUS);
  }

  let parsed: z.infer<typeof NpmLockfileSchema>;
  try {
    const result = NpmLockfileSchema.safeParse(JSON.parse(text));
    if (!result.success) {
      return failRead(LockfileReadFailures.UNPARSEABLE);
    }
    parsed = result.data;
  } catch {
    return failRead(LockfileReadFailures.UNPARSEABLE);
  }

  // npm 7+ installs from `packages:`, npm 6 from `dependencies:`; a v2 file
  // carries both, so a change in either one counts.
  const packages = parsed.packages ?? {};
  const tree = readV1Dependencies(
    parsed.dependencies ?? {},
    listLinkedFolders(packages),
  );
  const installed = readPackages(packages);
  if (!tree.ok) {
    return tree;
  }
  if (!installed.ok) {
    return installed;
  }
  const entries = [...tree.value, ...installed.value];
  if (!entries.every((entry) => isPackageName(entry.name))) {
    return failRead(LockfileReadFailures.UNPARSEABLE);
  }
  return { ok: true, value: entries };
}
