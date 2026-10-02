import type { AttributeDisplayMeta } from "../../../utils/repoConfig";

/** Repo-policy and de-emphasized risks carry detail behind a disclosure. */
export function isDisclosedRisk(
  meta: AttributeDisplayMeta | undefined,
): boolean {
  return meta?.source === "repo-policy" || meta?.deEmphasized === true;
}
