import { summarizeLockfile } from "../../../src/generation/shortened";
import { parseGitAttributes } from "../../../src/generation/shortened/gitattributes";
import {
  LockfileSideKinds,
  type LinguistRule,
  type LockfileSide,
  type LockfileSides,
  type LockfileSummary,
} from "../../../src/generation/shortened/types";

/** `undefined` stands for a file absent at that commit. */
function makeSide(text: string | undefined): LockfileSide {
  return text === undefined
    ? { kind: LockfileSideKinds.ABSENT }
    : { kind: LockfileSideKinds.TEXT, text };
}

export function makeSides(
  before: string | undefined,
  after: string | undefined,
): LockfileSides {
  return { before: makeSide(before), after: makeSide(after) };
}

export function summarizeTexts(
  path: string,
  before: string | undefined,
  after: string | undefined,
): LockfileSummary | undefined {
  return summarizeLockfile(path, makeSides(before, after));
}

/** The rules a `.gitattributes` sets, none when the reader refuses it, as the pipeline reads them. */
export function readGitAttributeRules(gitattributes: string): LinguistRule[] {
  const parsed = parseGitAttributes(gitattributes);
  return parsed.ok ? parsed.value : [];
}

/** A v9 pnpm lockfile holding each `key: resolution` with its snapshot. */
export function makePnpmLockfile(packages: Record<string, string>): string {
  const keys = Object.keys(packages);
  return [
    "lockfileVersion: '9.0'",
    "packages:",
    ...keys.map((key) => `  ${key}:\n    ${packages[key]}`),
    "snapshots:",
    ...keys.map((key) => `  ${key}: {}`),
    "",
  ].join("\n");
}

export function summarizePnpm(
  before: Record<string, string>,
  after: Record<string, string>,
): LockfileSummary {
  const summary = summarizeTexts(
    "pnpm-lock.yaml",
    makePnpmLockfile(before),
    makePnpmLockfile(after),
  );
  if (summary === undefined) {
    throw new Error("pnpm-lock.yaml is a lockfile");
  }
  return summary;
}
