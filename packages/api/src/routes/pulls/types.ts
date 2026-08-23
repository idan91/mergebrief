import type {
  ArtifactStore,
  GenerationProjection,
  RepoId,
  TenantRepository,
} from "persistence";

/** Narrow slices only — never full `AppDeps`. */
export interface PullsControllerDeps {
  readonly tenant: TenantRepository;
  readonly artifacts: ArtifactStore;
  readonly generations: GenerationProjection;
}

export interface ListPullsInput {
  /** repoId → GitHub-verified `owner/name`, from the shared allowed-set resolver. */
  readonly allowed: ReadonlyMap<RepoId, string>;
  readonly viewerLogin: string | null;
  readonly limit: number;
}
