// The release tool's composition root: argv enters here, the repo root is
// resolved from this file's location, and the exit code is the verdict.
// Everything below takes its inputs as parameters and never commits.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Mutable, Result } from "types/utils";

import { PUBLISH_TOKEN_ENV, RELEASES_DIR } from "./consts";
import { type ParsedArgv, parseArgv, readValuedFlag } from "./logic/argv";
import { checkReleases } from "./logic/check";
import { createCommandRunner } from "./logic/command-runner";
import { runExport } from "./logic/export";
import { resolvePublicRepositoryAccess } from "./logic/export/public-repository";
import { resolveExportTokens } from "./logic/export/tokens";
import type { ExportOptions } from "./logic/export/types";
import { createGitPort, GitCommandError } from "./logic/git-port";
import { runLicenses } from "./logic/licenses";
import { createPnpmLicensesPort } from "./logic/licenses/pnpm-port";
import {
  buildNoticesFolder,
  checkNoticesVersion,
  readLockfileElkjsVersions,
  readLockfileLibvipsVersions,
} from "./logic/notices";
import { NOTICES_DIR, SOURCES_FILE } from "./logic/notices/consts";
import { describeCrash, redactStreamOutput } from "./logic/redacted-output";
import { findCredentialedRemoteFlag } from "./logic/remote-url";
import { buildReleaseBody } from "./logic/release-body";
import { pruneTree, stampTree } from "./logic/stamp";
import { formatReleaseVersion, parseReleaseVersion } from "./logic/version";
import { buildVersionManifest } from "./logic/version-json";
import {
  type ExitCode,
  ExitCodes,
  type GitPort,
  type NotesError,
} from "./types";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const NOTES_DIR = join(REPO_ROOT, RELEASES_DIR);
const LOCKFILE = join(REPO_ROOT, "pnpm-lock.yaml");
const NOTICES_PATH = join(REPO_ROOT, NOTICES_DIR);

const USAGE = [
  "usage:",
  "  release check [--tag vX.Y.Z] [--known-tags v1,v2] [--json]",
  "      every notes file parses; the tag has one and is placed against the published tags, never the notes files",
  "  release stamp <version>                 write the version into the shipped manifests",
  "  release prune-manifest                  drop private and dependencies from the stamped CLI manifest, after the build",
  "  release version-json <tag> [--known-tags v1,v2] --out <file>",
  "      version.json over the stable notes files up to the tag; the tag must be the highest stable published",
  "  release release-body <tag> --out <file> the GitHub Release body for the tag",
  "  release export --version X.Y.Z --source <ref> [--dry-run [--expect-commit <sha>] | --emit <dir>]",
  "                 [--out <dir>] [--public-remote <url>] [--private-remote <url>] [--authenticated-reads]",
  "      the public snapshot of a commit on main, written to --out (a new temp dir when absent), checked,",
  `      then published as one commit and tag; a publish needs ${PUBLISH_TOKEN_ENV} set, a dry run pushes nothing;`,
  "      --emit runs no gate and writes the release bundle and plan.json for other jobs to gate and push,",
  "      --expect-commit refuses a gated rebuild that is not the emitted commit,",
  `      --authenticated-reads reads the target repository with ${PUBLISH_TOKEN_ENV}, for a target that is still private`,
  "  release licenses                        every production dependency's license is allowed or excepted by name",
  `  release notices                         rewrite ${NOTICES_DIR} for the sharp-libvips and elkjs versions the lockfile holds`,
  "      reads that release's tag and the SPDX licence texts on GitHub; check fails while the two disagree",
].join("\n");

const JSON_INDENT = 2;
/** Node's own exit code for an uncaught error, kept for the crashes caught below. */
const CRASH_EXIT_CODE = 1;

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

  const sourcesPath = join(NOTICES_PATH, SOURCES_FILE);
  const notices = checkNoticesVersion(
    readFileSync(LOCKFILE, "utf8"),
    existsSync(sourcesPath) ? readFileSync(sourcesPath, "utf8") : undefined,
  );
  if (!notices.ok) {
    process.stderr.write(`release: ${notices.error}\n`);
    return ExitCodes.REFUSED;
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
  const through = parseReleaseVersion(tag);
  const latestStable =
    read.value.tag?.isHighestStable === true && through !== undefined;
  if (!latestStable) {
    process.stderr.write(
      `release: ${tag} is not the highest stable release; version.json is written for the latest release only\n`,
    );
    return ExitCodes.REFUSED;
  }
  const manifest = buildVersionManifest(read.value.notes, through);
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

/** A path against the shell the root script ran in; pnpm -C moves the cwd. */
function resolveInvokedPath(given: string): string {
  const invokedFrom = process.env["INIT_CWD"] ?? process.cwd();
  return resolve(invokedFrom, given);
}

function resolveOutDir(given: string | undefined): string {
  if (given === undefined) {
    const outPrefix = join(tmpdir(), "mergebrief-export-");
    return mkdtempSync(outPrefix);
  }
  return resolveInvokedPath(given);
}

/** Why the export's mode flags cannot go together, if they cannot. */
function findModeConflict(parsed: ParsedArgv): string | undefined {
  const dryRun = parsed.flags.has("--dry-run");
  const emitDir = readValuedFlag(parsed, "--emit");
  const emitWithDryRun = emitDir !== undefined && dryRun;
  if (emitWithDryRun) {
    return "--emit runs no gate and pushes nothing; drop --dry-run";
  }
  const expectedCommit = readValuedFlag(parsed, "--expect-commit");
  const expectWithoutDryRun = expectedCommit !== undefined && !dryRun;
  if (expectWithoutDryRun) {
    return "--expect-commit checks a gated dry run; pass --dry-run";
  }
  return undefined;
}

function runExportCommand(argv: readonly string[]): ExitCode {
  const parsed = parseArgv(argv, {
    valued: [
      "--version",
      "--source",
      "--out",
      "--emit",
      "--expect-commit",
      "--public-remote",
      "--private-remote",
    ],
    boolean: ["--dry-run", "--authenticated-reads"],
    maxPositionals: 0,
  });
  if (!parsed.ok) {
    return refuseUsage(parsed.error);
  }
  const version = readValuedFlag(parsed.value, "--version");
  const source = readValuedFlag(parsed.value, "--source");
  const missingRequiredFlag = version === undefined || source === undefined;
  if (missingRequiredFlag) {
    return refuseUsage("export needs --version and --source");
  }
  const credentialedFlag = findCredentialedRemoteFlag(parsed.value);
  if (credentialedFlag !== undefined) {
    return refuseUsage(
      `${credentialedFlag} must not carry credentials in its URL`,
    );
  }
  const conflict = findModeConflict(parsed.value);
  if (conflict !== undefined) {
    return refuseUsage(conflict);
  }
  const emit = readValuedFlag(parsed.value, "--emit");
  const expectCommit = readValuedFlag(parsed.value, "--expect-commit");
  const dryRun = parsed.value.flags.has("--dry-run") || emit !== undefined;
  const tokens = resolveExportTokens(process.env[PUBLISH_TOKEN_ENV], {
    pushes: !dryRun,
    authenticatesReads: parsed.value.flags.has("--authenticated-reads"),
  });
  if (!tokens.ok) {
    process.stderr.write(`release: ${tokens.error}\n`);
    return ExitCodes.REFUSED;
  }

  const access = resolvePublicRepositoryAccess(
    readValuedFlag(parsed.value, "--public-remote"),
    tokens.value,
  );
  const options: Mutable<ExportOptions> = {
    version,
    source,
    out: resolveOutDir(readValuedFlag(parsed.value, "--out")),
    dryRun,
    publicRepository: access.repository,
  };
  if (tokens.value.publish !== undefined) {
    options.token = tokens.value.publish;
  }
  if (emit !== undefined) {
    options.emit = resolveInvokedPath(emit);
  }
  if (expectCommit !== undefined) {
    options.expectCommit = expectCommit;
  }
  const git = createGitPort(REPO_ROOT, {
    env: process.env,
    privateRemote: readValuedFlag(parsed.value, "--private-remote"),
    publicReadToken: access.readToken,
  });
  try {
    return exportTree(git, options);
  } catch (cause) {
    if (!(cause instanceof GitCommandError)) {
      throw cause;
    }
    process.stderr.write(`release: ${cause.message}\n`);
    return ExitCodes.REFUSED;
  } finally {
    git.discardScratchObjects();
  }
}

function exportTree(git: GitPort, options: ExportOptions): ExitCode {
  const result = runExport(
    {
      git,
      runner: createCommandRunner(process.env),
      print: (text) => process.stdout.write(text),
    },
    options,
  );
  if (!result.ok) {
    for (const line of result.error.reason.split("\n")) {
      process.stderr.write(`release: ${line}\n`);
    }
    return ExitCodes.REFUSED;
  }

  const { gates } = result.value;
  if (gates !== undefined && !gates.passed) {
    const stopped = gates.verdicts.at(-1)?.name ?? "unknown";
    process.stderr.write(
      `release: export stopped at gate ${stopped}; the tree is left at ${options.out}\n`,
    );
    return ExitCodes.REFUSED;
  }
  const commit = result.value.publish?.commit ?? "";
  process.stdout.write(
    `release: ${describeDone(options, commit)}; the tree is at ${options.out}\n`,
  );
  return ExitCodes.OK;
}

function describeDone(options: ExportOptions, commit: string): string {
  if (options.emit !== undefined) {
    return `planned ${commit} with no gate run; the bundle and plan are at ${options.emit}`;
  }
  if (options.dryRun) {
    return `every gate passed and ${commit} is what a publish would push`;
  }
  return `published ${options.version} as ${commit}`;
}

async function fetchText(url: string): Promise<Result<string, string>> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return { ok: false, error: `${url} did not answer` };
  }
  if (!response.ok) {
    return { ok: false, error: `${url} answered ${response.status}` };
  }
  return { ok: true, value: await response.text() };
}

async function runNotices(argv: readonly string[]): Promise<ExitCode> {
  const parsed = parseArgv(argv, {
    valued: [],
    boolean: [],
    maxPositionals: 0,
  });
  if (!parsed.ok) {
    return refuseUsage(parsed.error);
  }
  const lockfileText = readFileSync(LOCKFILE, "utf8");
  const versions = readLockfileLibvipsVersions(lockfileText);
  const [version] = versions;
  if (version === undefined || versions.length > 1) {
    process.stderr.write(
      `release: the lockfile must hold one sharp-libvips version, not [${versions.join(", ")}]\n`,
    );
    return ExitCodes.REFUSED;
  }
  const elkjsVersions = readLockfileElkjsVersions(lockfileText);
  if (elkjsVersions.length > 1) {
    process.stderr.write(
      `release: the lockfile must hold at most one elkjs version, not [${elkjsVersions.join(", ")}]\n`,
    );
    return ExitCodes.REFUSED;
  }

  const [elkjsVersion] = elkjsVersions;
  const built = await buildNoticesFolder(fetchText, version, elkjsVersion);
  if (!built.ok) {
    process.stderr.write(`release: ${built.error}\n`);
    return ExitCodes.REFUSED;
  }
  mkdirSync(NOTICES_PATH, { recursive: true });
  for (const file of built.value) {
    writeFileSync(join(NOTICES_PATH, file.fileName), file.text);
  }
  const elkjsWritten =
    elkjsVersion === undefined ? "" : ` and elkjs ${elkjsVersion}`;
  process.stdout.write(
    `release: wrote ${built.value.length} files to ${NOTICES_DIR} for sharp-libvips ${version}${elkjsWritten}\n`,
  );
  return ExitCodes.OK;
}

async function main(argv: readonly string[]): Promise<ExitCode> {
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
  if (command === "export") {
    return runExportCommand(rest);
  }
  if (command === "notices") {
    return runNotices(rest);
  }
  if (command === "licenses") {
    return runLicenses(rest, {
      port: createPnpmLicensesPort(REPO_ROOT),
      writeOut: (text) => process.stdout.write(text),
      writeError: (text) => process.stderr.write(text),
    });
  }
  return refuseUsage();
}

redactStreamOutput(process.stdout);
redactStreamOutput(process.stderr);
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (cause) {
  process.stderr.write(`release: ${describeCrash(cause)}\n`);
  process.exitCode = CRASH_EXIT_CODE;
}
