// The version surface on the wire: the server's own version, the latest
// release it knows of with the flags over the gap, and the viewer's own
// dismissal. Everything but `version` is absent until a check succeeds.

export interface VersionResponse {
  readonly version: string;
  readonly latest?: string;
  readonly releaseNotesUrl?: string;
  /** ISO timestamp of the last successful release check. */
  readonly checkedAt?: string;
  /** A release between the running version and `latest` needs more than the upgrade step. */
  readonly breaking?: boolean;
  /** A release between the running version and `latest` fixes a vulnerability. */
  readonly security?: boolean;
  /** The release the viewer dismissed the notice for; absent until they do. */
  readonly dismissedVersion?: string;
}

/** `dismiss-version-notice`: the release the notice is dismissed for. */
export interface DismissVersionNoticeBody {
  readonly version: string;
}
