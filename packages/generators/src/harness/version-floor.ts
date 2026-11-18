import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";

const VERSION_SHAPE = /(\d+)\.(\d+)\.(\d+)/;

/** The CLI version this adapter's hardening was last checked on. */
export interface CliVersionPolicy {
  /** The binary's name as an operator types it. */
  readonly cli: string;
  /** `MAJOR.MINOR.PATCH`, or cursor's `YYYY.MM.DD`. */
  readonly tested: string;
  /** How to update this CLI, appended to a refusal. */
  readonly updateHint: string;
}

interface CliVersion {
  /** The matched text, regex-constrained and safe to render. */
  readonly text: string;
  readonly parts: readonly [number, number, number];
}

function parseCliVersion(text: string): CliVersion | undefined {
  const match = VERSION_SHAPE.exec(text);
  if (match === null) {
    return undefined;
  }
  const [matched, major, minor, patch] = match;
  return {
    text: matched,
    parts: [Number(major), Number(minor), Number(patch)],
  };
}

function compareCliVersions(seen: CliVersion, tested: CliVersion): number {
  for (const [index, part] of seen.parts.entries()) {
    const difference = part - (tested.parts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * An older CLI may silently ignore a flag or config key the hardening sets,
 * so it refuses boot; a newer one may ship built-in tools nobody checked, so
 * it warns. Unreadable output warns: "could not verify" must surface.
 */
export function checkCliVersion(
  stdout: string,
  policy: CliVersionPolicy,
): Result<string | null, ConfigError> {
  const tested = parseCliVersion(policy.tested);
  if (tested === undefined) {
    throw new Error(
      `${policy.cli}: tested version ${policy.tested} is malformed`,
    );
  }
  const seen = parseCliVersion(stdout);
  if (seen === undefined) {
    return {
      ok: true,
      value: `warning: could not read a version from ${policy.cli} --version; the hardening checked on ${policy.tested} is unverifiable`,
    };
  }

  const order = compareCliVersions(seen, tested);
  if (order < 0) {
    return configError([
      `${policy.cli} ${seen.text} is older than ${policy.tested}, the oldest version MergeBrief's hardening was checked on; ${policy.updateHint}`,
    ]);
  }
  if (order > 0) {
    return {
      ok: true,
      value: `warning: ${policy.cli} ${seen.text} is newer than ${policy.tested}, the last version MergeBrief's hardening was checked on; built-in tools it added are not covered`,
    };
  }
  return { ok: true, value: null };
}
