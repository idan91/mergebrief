/** The release fields `/api/version` answers once a check succeeded. */
export interface ServerReleaseFields {
  readonly latest?: string;
  readonly releaseNotesUrl?: string;
  readonly checkedAt?: string;
  readonly breaking?: boolean;
  readonly security?: boolean;
}

export interface ServerStatus extends ServerReleaseFields {
  readonly reachable: boolean;
  /** null when unreachable (undetermined). */
  readonly authenticated: boolean | null;
  /** The server's version, null when undetermined. */
  readonly version: string | null;
}

/** The two-level `auth status` shape, additive-only. */
export interface AuthStatusBody {
  readonly profile: string;
  readonly baseUrl: string;
  readonly tokenConfigured: boolean;
  readonly cli: { readonly version: string };
  readonly server: ServerStatus;
}
