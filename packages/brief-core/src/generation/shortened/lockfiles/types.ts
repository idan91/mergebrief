import type { Result, ValueOf } from "types/utils";

/** Why a lockfile side could not be read. Every one fails closed downstream. */
export const LockfileReadFailures = {
  UNAVAILABLE: "unavailable",
  TOO_LARGE: "too-large",
  UNPARSEABLE: "unparseable",
  /** Duplicate keys, YAML anchors or merge keys: the package manager may read it otherwise. */
  AMBIGUOUS: "ambiguous",
} as const;
export type LockfileReadFailure = ValueOf<typeof LockfileReadFailures>;

/** One installed package record; `source` is what the package manager fetches it from. */
export interface LockfileEntry {
  name: string;
  version: string;
  source: string;
  /** Where the record is fetched from: a URL host, a protocol, or the registry; absent when unknown. */
  host?: string;
  /** The package an npm alias installs under `name`. */
  aliasOf?: string;
}

export type LockfileRead = Result<LockfileEntry[], LockfileReadFailure>;

export type ReadLockfile = (text: string) => LockfileRead;

export interface PackageKey {
  name: string;
  version: string;
}

export interface PackageVersion {
  name: string;
  version: string;
  /** The fetch hosts of this version's records; absent when any is unknown. */
  hosts?: string[];
  /** The package or packages an npm alias installs under `name`. */
  aliasOf?: string;
}

/** A version whose sources differ, with each side's hosts; absent when one is unknown. */
export interface PackageSourceChange {
  name: string;
  version: string;
  fromHosts?: string[];
  toHosts?: string[];
  fromAliasOf?: string;
  toAliasOf?: string;
}

export interface PackageUpdate {
  name: string;
  from: string;
  to: string;
  /** Absent when a host of the version is unknown. */
  fromHosts?: string[];
  toHosts?: string[];
  /** The package each side's npm alias installs; absent when that side is no alias. */
  fromAliasOf?: string;
  toAliasOf?: string;
}

export interface PackageChanges {
  added: PackageVersion[];
  removed: PackageVersion[];
  updated: PackageUpdate[];
  /** A package version whose set of sources (resolved URL, tarball, integrity, checksum) differs. */
  sourceChanged: PackageSourceChange[];
}

/** What one classic yarn field line held: a value, or the opener of a nested block. */
export const ClassicFieldReads = {
  VALUE: "value",
  BLOCK: "block",
} as const;
export type ClassicFieldRead = ValueOf<typeof ClassicFieldReads>;
