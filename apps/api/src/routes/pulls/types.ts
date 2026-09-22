import type {
  ArtifactStore,
  GenerationProjection,
  RepoId,
  TenantRepository,
} from "persistence";
import type { AllowedRepo } from "../installation-resolver";

/** Narrow slices only, never full `AppDeps`. */
export interface PullsControllerDeps {
  readonly tenant: TenantRepository;
  readonly artifacts: ArtifactStore;
  readonly generations: GenerationProjection;
}

export interface ListPullsInput {
  /** repoId → its installation and GitHub-verified `owner/name`. */
  readonly allowed: ReadonlyMap<RepoId, AllowedRepo>;
  readonly viewerLogin: string | null;
  readonly limit: number;
}
