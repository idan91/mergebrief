import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "types/utils";

import {
  CLI_PACKAGE_PATH,
  COMPOSE_PATHS,
  DEV_IMAGE_TAG,
  DEV_PACKAGE_VERSION,
  IMAGE_REPOSITORY,
} from "../consts";
import { PackageManifestSchema } from "../schemas";
import type { StampError } from "../types";
import { formatReleaseVersion, parseReleaseVersion } from "./version";

const DEV_IMAGE_LINE = `image: ${IMAGE_REPOSITORY}:${DEV_IMAGE_TAG}`;
// The whole line: indentation, the pin, then nothing but a comment. A
// commented-out pin, `:devel`, or `:dev-foo` is left alone and not counted.
const DEV_IMAGE_PATTERN = new RegExp(
  `^(\\s*)${escapeRegExp(DEV_IMAGE_LINE)}(\\s*(?:#.*)?)$`,
);
const JSON_INDENT = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keys the repo's manifest carries and the published one must not. */
const PRUNED_MANIFEST_KEYS: ReadonlySet<string> = new Set([
  "private",
  "dependencies",
]);

interface Manifest {
  /** The file's own object, key order intact; the parsed copy loses it. */
  readonly raw: Record<string, unknown>;
  readonly version: string;
}

function readManifest(path: string): Result<Manifest, StampError> {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = PackageManifestSchema.safeParse(raw);
  const manifestShaped = parsed.success && isRecord(raw);
  if (!manifestShaped) {
    const reason = "manifest is not an object with a string version";
    return { ok: false, error: { path, reason } };
  }
  return { ok: true, value: { raw, version: parsed.data.version } };
}

function serializeManifest(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, JSON_INDENT)}\n`;
}

/**
 * The stamped manifest text, nothing written: the version replaced and
 * every other key kept, so the tree still installs and builds; sentinel
 * only. The publish shape is `planManifestPrune`'s, after the build.
 */
export function planPackageStamp(
  path: string,
  version: string,
): Result<string, StampError> {
  const manifest = readManifest(path);
  if (!manifest.ok) {
    return manifest;
  }
  if (manifest.value.version !== DEV_PACKAGE_VERSION) {
    const reason = `version is ${manifest.value.version}, not the ${DEV_PACKAGE_VERSION} sentinel; stamp a clean checkout`;
    return { ok: false, error: { path, reason } };
  }

  const stamped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest.value.raw)) {
    stamped[key] = key === "version" ? version : value;
  }
  return { ok: true, value: serializeManifest(stamped) };
}

export function stampPackage(
  path: string,
  version: string,
): Result<void, StampError> {
  const planned = planPackageStamp(path, version);
  if (!planned.ok) {
    return planned;
  }
  writeFileSync(path, planned.value);
  return { ok: true, value: undefined };
}

/**
 * The published manifest text, nothing written: `private` and
 * `dependencies` dropped from a stamped manifest. The bundle inlines every
 * runtime dependency, and the repo keeps them under `dependencies` so
 * `pnpm audit --prod` still sees them; the shipped manifest must carry
 * none, or a publisher would rewrite the `workspace:` range to a public
 * package of the same name. Runs after the build: pnpm reinstalls before
 * a script whose manifest no longer matches the lockfile, which would
 * prune the bundle's inputs.
 */
export function planManifestPrune(path: string): Result<string, StampError> {
  const manifest = readManifest(path);
  if (!manifest.ok) {
    return manifest;
  }
  if (manifest.value.version === DEV_PACKAGE_VERSION) {
    const reason = `version is the ${DEV_PACKAGE_VERSION} sentinel; stamp the release version first`;
    return { ok: false, error: { path, reason } };
  }

  const pruned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest.value.raw)) {
    if (!PRUNED_MANIFEST_KEYS.has(key)) {
      pruned[key] = value;
    }
  }
  return { ok: true, value: serializeManifest(pruned) };
}

export function pruneManifest(path: string): Result<void, StampError> {
  const planned = planManifestPrune(path);
  if (!planned.ok) {
    return planned;
  }
  writeFileSync(path, planned.value);
  return { ok: true, value: undefined };
}

interface ComposeStamp {
  readonly text: string;
  readonly swapped: number;
}

/** The compose text with every `image: ...:dev` line swapped, nothing written. */
export function planComposeStamp(
  path: string,
  version: string,
): Result<ComposeStamp, StampError> {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const releaseLine = `image: ${IMAGE_REPOSITORY}:${version}`;

  let swapped = 0;
  const stamped = lines.map((line) => {
    const pinned = DEV_IMAGE_PATTERN.test(line);
    if (!pinned) {
      return line;
    }
    swapped += 1;
    return line.replace(DEV_IMAGE_PATTERN, `$1${releaseLine}$2`);
  });

  if (swapped === 0) {
    return { ok: false, error: { path, reason: `no ${DEV_IMAGE_LINE} line` } };
  }
  return { ok: true, value: { text: stamped.join("\n"), swapped } };
}

/** Swaps every `image: ...:dev` line for the version; the count comes back. */
export function stampComposeImage(
  path: string,
  version: string,
): Result<number, StampError> {
  const planned = planComposeStamp(path, version);
  if (!planned.ok) {
    return planned;
  }
  writeFileSync(path, planned.value.text);
  return { ok: true, value: planned.value.swapped };
}

/**
 * The CLI manifest and both compose files under `root`, in that order.
 * Every file is planned before the first write, so a refusal leaves the
 * tree untouched and the sentinel check still passes on the retry.
 */
export function stampTree(
  root: string,
  version: string,
): Result<readonly string[], StampError> {
  const parsed = parseReleaseVersion(version);
  if (parsed === undefined) {
    const reason = `${version} is not X.Y.Z or X.Y.Z-rc.N`;
    return { ok: false, error: { path: root, reason } };
  }
  const text = formatReleaseVersion(parsed);

  const writes: { path: string; content: string }[] = [];
  const manifestPath = join(root, CLI_PACKAGE_PATH);
  const manifest = planPackageStamp(manifestPath, text);
  if (!manifest.ok) {
    return manifest;
  }
  writes.push({ path: manifestPath, content: manifest.value });
  for (const composePath of COMPOSE_PATHS) {
    const fullPath = join(root, composePath);
    const compose = planComposeStamp(fullPath, text);
    if (!compose.ok) {
      return compose;
    }
    writes.push({ path: fullPath, content: compose.value.text });
  }

  for (const write of writes) {
    writeFileSync(write.path, write.content);
  }
  return { ok: true, value: [CLI_PACKAGE_PATH, ...COMPOSE_PATHS] };
}

/** Drops the publish-only keys from the CLI manifest under `root`. */
export function pruneTree(root: string): Result<string, StampError> {
  const manifestPath = join(root, CLI_PACKAGE_PATH);
  const pruned = pruneManifest(manifestPath);
  if (!pruned.ok) {
    return pruned;
  }
  return { ok: true, value: CLI_PACKAGE_PATH };
}
