import { LockfileFormats, type LockfileFormat } from "./types";

const OTHER_LOCKFILE_NAMES = [
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "pdm.lock",
  "uv.lock",
  "Pipfile.lock",
  "go.sum",
  "flake.lock",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "Package.resolved",
  "packages.lock.json",
  "gradle.lockfile",
];

/** Lockfiles by file name, wherever they sit in the tree. */
export const LOCKFILE_FORMAT_BY_NAME: ReadonlyMap<string, LockfileFormat> =
  new Map([
    ["pnpm-lock.yaml", LockfileFormats.PNPM],
    ["package-lock.json", LockfileFormats.NPM],
    ["npm-shrinkwrap.json", LockfileFormats.NPM],
    ["yarn.lock", LockfileFormats.YARN],
    ...OTHER_LOCKFILE_NAMES.map((name): [string, LockfileFormat] => [
      name,
      LockfileFormats.OTHER,
    ]),
  ]);

export const SUMMARY_LINE_INDENT = "  ";

/**
 * The most UTF-8 bytes of one lockfile side read; a bigger side is unread.
 * The largest pnpm, npm or yarn lockfile of the big public JS monorepos is
 * about 2.3 MB, and a realistic side this size parses in under 100 MB.
 */
export const LOCKFILE_MAX_BYTES = 8 * 1024 * 1024;
