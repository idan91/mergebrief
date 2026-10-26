import type { Mutable } from "types/utils";

import { RELEASE_IDENTITY } from "../../consts";
import type { ReleaseCommitInputs } from "../../types";

export interface ReleaseCommitSource {
  readonly treeSha: string;
  readonly parent?: string | undefined;
  readonly sourceCommitterDate: string;
  readonly version: string;
}

export function formatReleaseMessage(version: string): string {
  return `Release ${version}\n`;
}

export function buildReleaseCommitInputs(
  source: ReleaseCommitSource,
): ReleaseCommitInputs {
  const inputs: Mutable<ReleaseCommitInputs> = {
    treeSha: source.treeSha,
    author: RELEASE_IDENTITY,
    committer: RELEASE_IDENTITY,
    date: source.sourceCommitterDate,
    message: formatReleaseMessage(source.version),
  };
  if (source.parent !== undefined) {
    inputs.parent = source.parent;
  }
  return inputs;
}
