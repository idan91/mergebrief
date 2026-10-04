import type { VersionResponse } from "contract";

import { VersionStates, type PollInterval, type VersionState } from "./types";

const VERSION_POLL_MS = 60_000;

export interface ReleaseNotice {
  readonly current: string;
  readonly latest: string;
  readonly releaseNotesUrl: string | undefined;
  readonly breaking: boolean;
  readonly security: boolean;
}

function shapeNotice(snapshot: VersionResponse, latest: string): ReleaseNotice {
  return {
    current: snapshot.version,
    latest,
    releaseNotesUrl: snapshot.releaseNotesUrl,
    breaking: snapshot.breaking === true,
    security: snapshot.security === true,
  };
}

/** A signed-out viewer has nothing to learn from the poll; sign-in re-mounts the page. */
export function resolvePollInterval(
  state: VersionState | undefined,
): PollInterval {
  if (state?.kind === VersionStates.SIGNED_OUT) {
    return false;
  }
  return VERSION_POLL_MS;
}

/**
 * The release the band announces, or nothing: no successful check, the
 * instance already runs it, or the viewer dismissed it (a security release
 * cannot be dismissed).
 */
export function deriveReleaseNotice(
  state: VersionState | undefined,
): ReleaseNotice | undefined {
  if (state === undefined || state.kind !== VersionStates.KNOWN) {
    return undefined;
  }
  const { snapshot } = state;
  const { latest } = snapshot;
  if (latest === undefined || latest === snapshot.version) {
    return undefined;
  }

  const notice = shapeNotice(snapshot, latest);
  const dismissed = !notice.security && snapshot.dismissedVersion === latest;
  return dismissed ? undefined : notice;
}
