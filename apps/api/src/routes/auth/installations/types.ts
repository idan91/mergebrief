import type { Logger } from "logging";
import type {
  InstallationId,
  SessionAuth,
  UserSettingsStore,
} from "persistence";
import type {
  AccessibleInstallationsResolver,
  AccessibleSetFailure,
} from "../accessible-installations";
import type { AuthRouteDeps, ViewerPrincipal } from "../session/types";

/** Failures the handler judges; the resolver's kinds ride whole. */
export type InstallationsFailure =
  | AccessibleSetFailure
  | { readonly kind: "target-not-accessible" }
  | { readonly kind: "session-vanished" };

/** Narrow slices; stores are constructed by the handler, never in ops. */
export interface InstallationsControllerDeps {
  readonly deps: AuthRouteDeps;
  readonly installations: AccessibleInstallationsResolver;
  readonly session: ViewerPrincipal;
  readonly log: Logger;
  readonly sessions: SessionAuth;
  readonly settings: UserSettingsStore;
}

export interface InstallationEntry {
  readonly installationId: string;
  readonly accountLogin: string;
  readonly isCurrent: boolean;
  readonly isDefault: boolean;
}

export interface ListInstallationsBody {
  readonly installations: readonly InstallationEntry[];
  readonly currentInstallationId: string;
  readonly defaultInstallationId: string | null;
}

export interface SelectInstallationBody {
  readonly currentInstallationId: string;
  readonly defaultInstallationId: string | null;
}

export interface SelectInstallationInput {
  readonly target: InstallationId;
  readonly setDefault: boolean;
}
