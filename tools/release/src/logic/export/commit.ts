import type { Mutable } from "types/utils";

import { CO_AUTHOR_DROP_EMAILS, RELEASE_IDENTITY } from "../../consts";
import type { ReleaseCommitInputs } from "../../types";

const TRAILER_VALUE = /^(?<name>.*\S)\s+<(?<email>[^<>\s]+)>$/;

const DROPPED_EMAILS: ReadonlySet<string> = new Set(
  CO_AUTHOR_DROP_EMAILS.map((email) => email.toLowerCase()),
);

export interface ReleaseCommitSource {
  readonly treeSha: string;
  readonly parent?: string | undefined;
  readonly sourceCommitterDate: string;
  readonly version: string;
  readonly trailers: readonly string[];
}

/** UTF-16 code unit order: the same on every host, where `localeCompare` follows the host's collation and would move the release SHA. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * The contributors a release credits: every `Co-authored-by` value, one
 * line per address with its first spelling kept, the maintainer's and the
 * agents' addresses left out, sorted by address so the message is stable.
 */
export function collectCoAuthorTrailers(
  values: readonly string[],
): readonly string[] {
  const byEmail = new Map<string, string>();
  for (const value of values) {
    const email = TRAILER_VALUE.exec(value.trim())?.groups?.["email"];
    if (email === undefined) {
      continue;
    }
    const key = email.toLowerCase();
    const skipped = DROPPED_EMAILS.has(key) || byEmail.has(key);
    if (skipped) {
      continue;
    }
    byEmail.set(key, value.trim());
  }

  const entries = [...byEmail.entries()];
  const sorted = entries
    .toSorted(([left], [right]) => compareCodeUnits(left, right))
    .map(([, value]) => value);
  return sorted;
}

export function formatReleaseMessage(
  version: string,
  trailers: readonly string[],
): string {
  const subject = `Release ${version}\n`;
  if (trailers.length === 0) {
    return subject;
  }
  const body = trailers.map((value) => `Co-authored-by: ${value}\n`).join("");
  return `${subject}\n${body}`;
}

export function buildReleaseCommitInputs(
  source: ReleaseCommitSource,
): ReleaseCommitInputs {
  const inputs: Mutable<ReleaseCommitInputs> = {
    treeSha: source.treeSha,
    author: RELEASE_IDENTITY,
    committer: RELEASE_IDENTITY,
    date: source.sourceCommitterDate,
    message: formatReleaseMessage(source.version, source.trailers),
  };
  if (source.parent !== undefined) {
    inputs.parent = source.parent;
  }
  return inputs;
}
