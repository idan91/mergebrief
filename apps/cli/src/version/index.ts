// What the CLI says about versions: the semver compare, the two major-gap
// lines, the failure suffix, and the update command for the launch form.
import {
  CLI_BEHIND_REASON,
  DEV_VERSIONS,
  MAJOR_GAP_SUFFIX,
  NPM_COMMAND_ENV,
  NPM_EXEC_COMMAND,
  PACKAGE_NAME,
  SERVER_BEHIND_REASON,
} from "./consts";
import type { Result } from "types/utils";
import { LaunchForms, type LaunchForm, type Semver, type Skew } from "./types";

export { NO_VERSION_WARNING_ENV, VERSION_HEADER } from "./consts";
export type { LaunchForm, Skew } from "./types";

const SEMVER_PATTERN =
  /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:\+[0-9A-Za-z.-]+)?$/;
const PRERELEASE_PATTERN = /^v?\d{1,9}\.\d{1,9}\.\d{1,9}-/;
const NOT_SEMVER = "not major.minor.patch";
const PRERELEASE = "a prerelease is not a release";

/**
 * A release is `major.minor.patch`, a leading `v` and `+build` metadata
 * allowed. A `-prerelease` suffix is refused on its own reason, so an RC
 * never compares equal to the release it precedes.
 */
export function parseSemver(value: string): Result<Semver, string> {
  const text = value.trim();
  if (PRERELEASE_PATTERN.test(text)) {
    return { ok: false, error: PRERELEASE };
  }
  const match = SEMVER_PATTERN.exec(text);
  if (match === null) {
    return { ok: false, error: NOT_SEMVER };
  }
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) {
    return { ok: false, error: NOT_SEMVER };
  }
  return {
    ok: true,
    value: { major: Number(major), minor: Number(minor), patch: Number(patch) },
  };
}

export function compareSemver(left: Semver, right: Semver): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

/** The canonical `major.minor.patch`: what every line prints, never raw header text. */
export function formatSemver(version: Semver): string {
  return `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`;
}

export function isDevVersion(value: string): boolean {
  return DEV_VERSIONS.has(value);
}

/** The skew between two releases, or nothing: equal, non-semver or a dev build on either side. */
export function deriveSkew(
  server: string | undefined,
  cli: string,
): Skew | undefined {
  if (server === undefined || isDevVersion(server) || isDevVersion(cli)) {
    return undefined;
  }
  const serverParse = parseSemver(server);
  const cliParse = parseSemver(cli);
  if (!serverParse.ok || !cliParse.ok) {
    return undefined;
  }
  const serverVersion = serverParse.value;
  const cliVersion = cliParse.value;

  const direction = compareSemver(cliVersion, serverVersion);
  if (direction === 0) {
    return undefined;
  }
  return {
    server: formatSemver(serverVersion),
    cli: formatSemver(cliVersion),
    majorGap: cliVersion.major !== serverVersion.major,
    direction,
  };
}

export function detectLaunchForm(
  env: Readonly<Record<string, string | undefined>>,
): LaunchForm {
  return env[NPM_COMMAND_ENV] === NPM_EXEC_COMMAND
    ? LaunchForms.NPX
    : LaunchForms.GLOBAL;
}

/** The command that puts `version` in the user's hands, in the form they launched. */
export function buildUpdateCommand(
  version: string,
  launch: LaunchForm,
): string {
  if (launch === LaunchForms.NPX) {
    return `npx ${PACKAGE_NAME}@${version}`;
  }
  return `npm i -g ${PACKAGE_NAME}@${version}`;
}

/** The warning after a successful run; only a major gap earns one. */
export function buildMajorWarning(
  skew: Skew | undefined,
  launch: LaunchForm,
): string | undefined {
  if (skew === undefined || !skew.majorGap) {
    return undefined;
  }
  if (skew.direction < 0) {
    return (
      `${PACKAGE_NAME} ${skew.cli} is behind this server (${skew.server}): ` +
      `${CLI_BEHIND_REASON}. To update, run: ${buildUpdateCommand(skew.server, launch)}`
    );
  }
  return (
    `This server (${skew.server}) is behind ${PACKAGE_NAME} ${skew.cli}: ` +
    `${SERVER_BEHIND_REASON}. To match it, run: ${buildUpdateCommand(skew.server, LaunchForms.NPX)}`
  );
}

/** What the one error line gains while versions differ. */
export function buildFailureSuffix(skew: Skew | undefined): string {
  if (skew === undefined) {
    return "";
  }
  const gap = skew.majorGap ? `, ${MAJOR_GAP_SUFFIX}` : "";
  return ` [server ${skew.server}, cli ${skew.cli}${gap}]`;
}
