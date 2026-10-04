// The release tool's composition root: argv enters here, the repo root is
// resolved from this file's location, and the exit code is the verdict.
// Everything below takes its inputs as parameters and never commits.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Mutable } from "types/utils";

import { RELEASES_DIR } from "./consts";
import { type ParsedArgv, parseArgv, readValuedFlag } from "./logic/argv";
import { checkReleases } from "./logic/check";
import { type CutOptions, executeCut, planCut } from "./logic/cut";
import { createGitPort, GitCommandError } from "./logic/git-port";
import { buildReleaseBody } from "./logic/release-body";
import { pruneTree, stampTree } from "./logic/stamp";
import { formatReleaseVersion } from "./logic/version";
import { buildVersionManifest } from "./logic/version-json";
import {
  type BumpLevel,
  BumpLevels,
  type ExitCode,
  ExitCodes,
  type NotesError,
} from "./types";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const NOTES_DIR = join(REPO_ROOT, RELEASES_DIR);

const USAGE = [
  "usage:",
  "  release check [--tag vX.Y.Z] [--known-tags v1,v2] [--json]",
  "      every notes file parses; the tag has one and is placed against the published tags",
  "  release stamp <version>                 write the version into the shipped manifests",
  "  release prune-manifest                  drop private and dependencies from the stamped CLI manifest, after the build",
  "  release version-json <tag> [--known-tags v1,v2] --out <file>",
  "      version.json over every stable notes file; the tag must be the highest stable",
  "  release release-body <tag> --out <file> the GitHub Release body for the tag",
  "  release cut <major|minor|patch> [--rc] [--at <ref>] [--push] [--dry-run]",
  "      tag the tip of main as fetched, or --at a commit on it; the notes file must be in it",
].join("\n");

const JSON_INDENT = 2;

function refuseUsage(reason?: string): ExitCode {
  if (reason !== undefined) {
    process.stderr.write(`release: ${reason}\n`);
  }
  process.stderr.write(`${USAGE}\n`);
  return ExitCodes.USAGE;
}

function reportNotesErrors(errors: readonly NotesError[]): ExitCode {
  for (const error of errors) {
    process.stderr.write(`release: ${error.path}: ${error.reason}\n`);
  }
  return ExitCodes.REFUSED;
}

function readKnownTags(parsed: ParsedArgv): readonly string[] {
  return readValuedFlag(parsed, "--known-tags")?.split(",") ?? [];
}

function runCheck(argv: readonly string[]): ExitCode {
  const parsed = parseArgv(argv, {
    valued: ["--tag", "--known-tags"],
    boolean: ["--json"],
    maxPositionals: 0,
  });
  if (!parsed.ok) {
    return refuseUsage(parsed.error);
  }

  const result = checkReleases(
    NOTES_DIR,
    readValuedFlag(parsed.value, "--tag"),
    readKnownTags(parsed.value),
  );
  if (!result.ok) {
    return reportNotesErrors(result.error);
  }

  if (parsed.value.flags.has("--json")) {
    process.stdout.write(`${JSON.stringify(result.value.tag ?? {})}\n`);
  } else {
    const placed =
      result.value.tag === undefined ? "" : ` (${result.value.tag.version} ok)`;
    process.stdout.write(
      `release: ${result.value.notes.length} notes files ok${placed}\n`,
    );
  }
  return ExitCodes.OK;
}

function runStamp(argv: readonly string[]): ExitCode {
  const parsed = parseArgv(argv, {
    valued: [],
    boolean: [],
    maxPositionals: 1,
  });
  const version = parsed.ok ? parsed.value.positionals[0] : undefined;
  const usage = !parsed.ok || version === undefined;
  if (usage) {
    return refuseUsage(parsed.ok ? undefined : parsed.error);
  }

  const result = stampTree(REPO_ROOT, version);
  if (!result.ok) {
    process.stderr.write(
      `release: ${result.error.path}: ${result.error.reason}\n`,
    );
    return ExitCodes.REFUSED;
  }
  process.stdout.write(
    `release: stamped ${version} into ${result.value.join(", ")}\n`,
  );
  return ExitCodes.OK;
}

function runPruneManifest(argv: readonly string[]): ExitCode {
  const parsed = parseArgv(argv, {
    valued: [],
    boolean: [],
    maxPositionals: 0,
  });
  if (!parsed.ok) {
    return refuseUsage(parsed.error);
  }

  const result = pruneTree(REPO_ROOT);
  if (!result.ok) {
    process.stderr.write(
      `release: ${result.error.path}: ${result.error.reason}\n`,
    );
    return ExitCodes.REFUSED;
  }
  process.stdout.write(`release: pruned ${result.value} for publish\n`);
  return ExitCodes.OK;
}

function runVersionJson(argv: readonly string[]): ExitCode {
  const parsed = parseArgv(argv, {
    valued: ["--known-tags", "--out"],
    boolean: [],
    maxPositionals: 1,
  });
  const tag = parsed.ok ? parsed.value.positionals[0] : undefined;
  const out = parsed.ok ? readValuedFlag(parsed.value, "--out") : undefined;
  const usage = !parsed.ok || tag === undefined || out === undefined;
  if (usage) {
    return refuseUsage(parsed.ok ? undefined : parsed.error);
  }

  const read = checkReleases(NOTES_DIR, tag, readKnownTags(parsed.value));
  if (!read.ok) {
    return reportNotesErrors(read.error);
  }
  if (read.value.tag?.isHighestStable !== true) {
    process.stderr.write(
      `release: ${tag} is not the highest stable release; version.json is written for the latest release only\n`,
    );
    return ExitCodes.REFUSED;
  }
  const manifest = buildVersionManifest(read.value.notes);
  if (!manifest.ok) {
    process.stderr.write(`release: ${manifest.error}\n`);
    return ExitCodes.REFUSED;
  }

  writeFileSync(out, `${JSON.stringify(manifest.value, null, JSON_INDENT)}\n`);
  process.stdout.write(
    `release: wrote ${out} (latest ${manifest.value.latest})\n`,
  );
  return ExitCodes.OK;
}

function runReleaseBody(argv: readonly string[]): ExitCode {
  const parsed = parseArgv(argv, {
    valued: ["--out"],
    boolean: [],
    maxPositionals: 1,
  });
  const tag = parsed.ok ? parsed.value.positionals[0] : undefined;
  const out = parsed.ok ? readValuedFlag(parsed.value, "--out") : undefined;
  const usage = !parsed.ok || tag === undefined || out === undefined;
  if (usage) {
    return refuseUsage(parsed.ok ? undefined : parsed.error);
  }

  const read = checkReleases(NOTES_DIR, tag);
  if (!read.ok) {
    return reportNotesErrors(read.error);
  }
  const placed = read.value.tag;
  const own = read.value.notes.find(
    (notes) =>
      placed !== undefined &&
      formatReleaseVersion(notes.version) === placed.version,
  );
  if (own === undefined) {
    process.stderr.write(`release: no notes for ${tag}\n`);
    return ExitCodes.REFUSED;
  }

  writeFileSync(out, buildReleaseBody(own));
  process.stdout.write(`release: wrote ${out} for ${tag}\n`);
  return ExitCodes.OK;
}

function isBumpLevel(value: string): value is BumpLevel {
  const levels: readonly string[] = Object.values(BumpLevels);
  const known = levels.includes(value);
  return known;
}

function runCut(argv: readonly string[]): ExitCode {
  const parsed = parseArgv(argv, {
    valued: ["--at"],
    boolean: ["--rc", "--push", "--dry-run"],
    maxPositionals: 1,
  });
  const level = parsed.ok ? parsed.value.positionals[0] : undefined;
  const usage = !parsed.ok || level === undefined || !isBumpLevel(level);
  if (usage) {
    const reason = parsed.ok ? "cut needs major, minor or patch" : parsed.error;
    return refuseUsage(reason);
  }
  const dryRun = parsed.value.flags.has("--dry-run");
  const push = parsed.value.flags.has("--push");
  if (dryRun && push) {
    return refuseUsage("--dry-run and --push exclude each other");
  }

  try {
    return cutRelease(parsed.value, level, { dryRun, push });
  } catch (cause) {
    if (!(cause instanceof GitCommandError)) {
      throw cause;
    }
    process.stderr.write(`release: ${cause.message}\n`);
    return ExitCodes.REFUSED;
  }
}

interface CutModes {
  readonly dryRun: boolean;
  readonly push: boolean;
}

function cutRelease(
  parsed: ParsedArgv,
  level: BumpLevel,
  modes: CutModes,
): ExitCode {
  const git = createGitPort(REPO_ROOT);
  const options: Mutable<CutOptions> = {
    level,
    candidate: parsed.flags.has("--rc"),
  };
  const at = readValuedFlag(parsed, "--at");
  if (at !== undefined) {
    options.ref = at;
  }
  const plan = planCut(git, options);
  if (!plan.ok) {
    process.stderr.write(`release: ${plan.error.reason}\n`);
    return ExitCodes.REFUSED;
  }

  const summary = `${plan.value.tag} at ${plan.value.commit} (${plan.value.notesPath} ok)`;
  if (modes.dryRun) {
    process.stdout.write(`release: would tag ${summary}\n`);
    return ExitCodes.OK;
  }
  const done = executeCut(git, plan.value, modes.push);
  if (!done.ok) {
    process.stderr.write(`release: ${done.error.reason}\n`);
    return ExitCodes.REFUSED;
  }
  const next = modes.push
    ? "pushed; the release workflow is running"
    : `push it with: git push origin ${plan.value.tag}`;
  process.stdout.write(`release: tagged ${summary}; ${next}\n`);
  return ExitCodes.OK;
}

function main(argv: readonly string[]): ExitCode {
  const [command, ...rest] = argv;
  if (command === "check") {
    return runCheck(rest);
  }
  if (command === "stamp") {
    return runStamp(rest);
  }
  if (command === "prune-manifest") {
    return runPruneManifest(rest);
  }
  if (command === "version-json") {
    return runVersionJson(rest);
  }
  if (command === "release-body") {
    return runReleaseBody(rest);
  }
  if (command === "cut") {
    return runCut(rest);
  }
  return refuseUsage();
}

process.exitCode = main(process.argv.slice(2));
