import type { RowPurgeFailure } from "../../../purge-row";
import type { FreshRepositoryFailure } from "../../logic/fresh-repository";

/** The fresh read says the viewer is no repository admin. */
export interface NotRepoAdminFailure {
  readonly kind: "not-repo-admin";
}

export type DeletePullFailure =
  | FreshRepositoryFailure
  | NotRepoAdminFailure
  | RowPurgeFailure;
