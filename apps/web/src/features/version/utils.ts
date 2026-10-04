import type { VersionResponse } from "contract";
import { z } from "zod/v4";

import { VersionStates, type PollInterval, type VersionState } from "./types";

const VERSION_POLL_MS = 60_000;

export const SEEN_VERSION_STORAGE_KEY = "mergebrief.versionSeen";

const seenVersionSchema = z.string().min(1);
const seenListeners = new Set<() => void>();
/** The seen bit for this page when storage is denied; the dot still clears. */
let seenInMemory: string | undefined;

function notifySeenListeners(): void {
  for (const listener of seenListeners) {
    listener();
  }
}

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

function readNewerRelease(
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
  return shapeNotice(snapshot, latest);
}

function isDismissed(state: VersionState, notice: ReleaseNotice): boolean {
  if (state.kind !== VersionStates.KNOWN || notice.security) {
    return false;
  }
  return state.snapshot.dismissedVersion === notice.latest;
}

/**
 * The release the band announces, or nothing: no successful check, the
 * instance already runs it, or the viewer dismissed it (a security release
 * cannot be dismissed).
 */
export function deriveReleaseNotice(
  state: VersionState | undefined,
): ReleaseNotice | undefined {
  const notice = readNewerRelease(state);
  if (state === undefined || notice === undefined) {
    return undefined;
  }
  return isDismissed(state, notice) ? undefined : notice;
}

/** The release the viewer dismissed while it is still the latest: the Account menu's row. */
export function deriveDismissedNotice(
  state: VersionState | undefined,
): ReleaseNotice | undefined {
  const notice = readNewerRelease(state);
  if (state === undefined || notice === undefined) {
    return undefined;
  }
  return isDismissed(state, notice) ? notice : undefined;
}

function readStoredSeenVersion(): string | undefined {
  try {
    const raw = window.localStorage.getItem(SEEN_VERSION_STORAGE_KEY);
    if (raw === null) {
      return undefined;
    }

    const parsed = seenVersionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The release the viewer already opened the menu for; absent when none. */
export function readSeenVersion(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return readStoredSeenVersion() ?? seenInMemory;
}

export function writeSeenVersion(version: string): void {
  if (typeof window === "undefined") {
    return;
  }

  seenInMemory = version;
  try {
    window.localStorage.setItem(
      SEEN_VERSION_STORAGE_KEY,
      JSON.stringify(version),
    );
  } catch {
    // Storage denied (private mode, quota): the in-memory bit carries this page.
  }
  notifySeenListeners();
}

/** The server cannot read the seen bit, so it renders no dot; an unseen release gets its dot after hydration. */
export const SEEN_VERSION_UNKNOWN = "unknown";

export function readServerSeenVersion(): typeof SEEN_VERSION_UNKNOWN {
  return SEEN_VERSION_UNKNOWN;
}

/** Wakes on a write in this page and on a write from another tab. */
export function subscribeSeenVersion(listener: () => void): () => void {
  seenListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    seenListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
