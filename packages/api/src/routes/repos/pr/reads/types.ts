import type { ArtifactStore, TenantRepository } from "persistence";

/** Narrow slices only — never full `AppDeps`. */
export interface ReadsControllerDeps {
  readonly tenant: TenantRepository;
  readonly artifacts: ArtifactStore;
}
