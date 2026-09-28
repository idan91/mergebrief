import type { GitHubApiError } from "github";
import type { ArtifactStore, TenantRepository } from "persistence";
import type { FailureKinds } from "../../../../shared-errors/failures";

/** Narrow slices only, never full `AppDeps`. */
export interface ReadsControllerDeps {
  readonly tenant: TenantRepository;
  readonly artifacts: ArtifactStore;
}

/** Result-side failures of the live diff proxy; the handler owns posture. */
export type DiffFailure =
  | { readonly kind: typeof FailureKinds.TOKEN_UNREADABLE }
  | {
      readonly kind: typeof FailureKinds.GITHUB_DENIED;
      readonly error: GitHubApiError;
      /** True when the failure survived a post-refresh retry. */
      readonly retried: boolean;
    };

/** Result-side failures of the live stack read; the same two the diff proxy has. */
export type StackFailure = DiffFailure;

/** Result-side failures of the file-range read; the handler owns posture. */
export type FileRangeFailure =
  | { readonly kind: typeof FailureKinds.TOKEN_UNREADABLE }
  | {
      readonly kind: typeof FailureKinds.GITHUB_DENIED;
      readonly error: GitHubApiError;
      /** True when the failure survived a post-refresh retry. */
      readonly retried: boolean;
    }
  | { readonly kind: "file-absent" }
  | { readonly kind: "file-too-large" }
  | { readonly kind: "file-not-text" };
