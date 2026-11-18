import type { VersionResponse } from "contract";
import type { Logger } from "logging";

/** What the check answers; the route adds the viewer's dismissal on top. */
export type VersionSnapshot = Omit<VersionResponse, "dismissedVersion">;

export interface ReleaseEntry {
  readonly version: string;
  readonly date?: string;
  readonly breaking: boolean;
  readonly security: boolean;
  readonly notesUrl?: string;
}

export interface VersionManifest {
  readonly latest: string;
  readonly releaseNotesUrl?: string;
  readonly releases: readonly ReleaseEntry[];
}

export interface UpdateCheckDeps {
  readonly serverVersion: string;
  readonly enabled: boolean;
  readonly url: string;
  readonly fetch: typeof fetch;
  readonly log: Logger;
  /** Test seam; production takes the const. */
  readonly bootDelayMs?: number;
}

export interface UpdateCheck {
  /** Arms the one boot-delayed fetch; a no-op when the check is off. */
  start(): void;
  stop(): void;
  /** One fetch and parse; failures land in the log, never throw. */
  refresh(): Promise<void>;
  /** The cached answer; kicks a background refresh when it is older than a day. */
  snapshot(): VersionSnapshot;
}
