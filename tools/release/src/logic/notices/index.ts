// The image ships two components under copyleft licences: sharp's libvips
// (LGPL) and Mermaid's elkjs (EPL-2.0). It carries their notices, the licence
// texts and where each source is. The folder is regenerated from the versions
// the lockfile holds, and the check fails the moment the two disagree.
import type { Mutable, Result } from "types/utils";

import {
  ELKJS_PACKAGE,
  LIBVIPS_PACKAGE_PREFIX,
  NOTICES_DIR,
  RECORDED_ELKJS_VERSION_LABEL,
  RECORDED_LIBVIPS_VERSION_LABEL,
  REGENERATE_COMMAND,
} from "./consts";
import {
  readLockfileElkjsVersions,
  readLockfileLibvipsVersions,
} from "./lockfile";
import type { NoticedVersions } from "./types";

export { buildNoticesFolder } from "./folder";
export {
  readLockfileElkjsVersions,
  readLockfileLibvipsVersions,
} from "./lockfile";

function readRecordedVersion(
  label: string,
  sourcesText: string,
): string | undefined {
  const [, version] =
    new RegExp(`^${label} (\\S+)$`, "m").exec(sourcesText) ?? [];
  return version;
}

function refuse(reason: string): Result<never, string> {
  return { ok: false, error: reason };
}

function checkLibvipsVersion(
  lockfileText: string,
  sourcesText: string | undefined,
): Result<string | undefined, string> {
  const versions = readLockfileLibvipsVersions(lockfileText);
  const [lockedVersion] = versions;
  if (lockedVersion === undefined) {
    if (sourcesText === undefined) {
      return { ok: true, value: undefined };
    }
    return refuse(
      `the lockfile holds no ${LIBVIPS_PACKAGE_PREFIX}* package; delete ${NOTICES_DIR}`,
    );
  }
  if (versions.length > 1) {
    return refuse(
      `the lockfile holds more than one sharp-libvips version: ${versions.join(", ")}`,
    );
  }
  if (sourcesText === undefined) {
    return refuse(
      `the lockfile holds sharp-libvips ${lockedVersion} but ${NOTICES_DIR} is missing; run ${REGENERATE_COMMAND}`,
    );
  }

  const recorded = readRecordedVersion(
    RECORDED_LIBVIPS_VERSION_LABEL,
    sourcesText,
  );
  if (recorded === undefined) {
    return refuse(
      `${NOTICES_DIR} records no sharp-libvips version; run ${REGENERATE_COMMAND}`,
    );
  }
  if (recorded !== lockedVersion) {
    return refuse(
      `${NOTICES_DIR} records sharp-libvips ${recorded} but the lockfile holds ${lockedVersion}; run ${REGENERATE_COMMAND}`,
    );
  }
  return { ok: true, value: lockedVersion };
}

function checkElkjsVersion(
  lockfileText: string,
  sourcesText: string | undefined,
): Result<string | undefined, string> {
  const versions = readLockfileElkjsVersions(lockfileText);
  if (versions.length > 1) {
    return refuse(
      `the lockfile holds more than one ${ELKJS_PACKAGE} version: ${versions.join(", ")}`,
    );
  }

  const [lockedVersion] = versions;
  const recorded =
    sourcesText === undefined
      ? undefined
      : readRecordedVersion(RECORDED_ELKJS_VERSION_LABEL, sourcesText);
  if (recorded === lockedVersion) {
    return { ok: true, value: lockedVersion };
  }
  const regenerate = `run ${REGENERATE_COMMAND}`;
  if (lockedVersion === undefined) {
    return refuse(
      `${NOTICES_DIR} records ${ELKJS_PACKAGE} ${recorded} but the lockfile holds none; ${regenerate}`,
    );
  }
  if (recorded === undefined) {
    return refuse(
      `the lockfile holds ${ELKJS_PACKAGE} ${lockedVersion} but ${NOTICES_DIR} records none; ${regenerate}`,
    );
  }
  return refuse(
    `${NOTICES_DIR} records ${ELKJS_PACKAGE} ${recorded} but the lockfile holds ${lockedVersion}; ${regenerate}`,
  );
}

/**
 * Passes when the folder records each noticed version the lockfile holds and
 * none it does not, or when nothing noticed ships; the value is those versions.
 */
export function checkNoticesVersion(
  lockfileText: string,
  sourcesText: string | undefined,
): Result<NoticedVersions, string> {
  const libvips = checkLibvipsVersion(lockfileText, sourcesText);
  if (!libvips.ok) {
    return libvips;
  }
  const elkjs = checkElkjsVersion(lockfileText, sourcesText);
  if (!elkjs.ok) {
    return elkjs;
  }

  const versions: Mutable<NoticedVersions> = {};
  if (libvips.value !== undefined) {
    versions.libvips = libvips.value;
  }
  if (elkjs.value !== undefined) {
    versions.elkjs = elkjs.value;
  }
  return { ok: true, value: versions };
}
