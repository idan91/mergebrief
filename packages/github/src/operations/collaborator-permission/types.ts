import type { ValueOf } from "types/utils";

/** GitHub's `permission` field: `maintain` folds into `write`, `triage` into `read`. */
export const CollaboratorPermissions = {
  ADMIN: "admin",
  WRITE: "write",
  READ: "read",
  NONE: "none",
} as const;
export type CollaboratorPermission = ValueOf<typeof CollaboratorPermissions>;

/** Write access or higher. */
export const TRUSTED_COLLABORATOR_PERMISSIONS: ReadonlySet<CollaboratorPermission> =
  new Set([CollaboratorPermissions.ADMIN, CollaboratorPermissions.WRITE]);
