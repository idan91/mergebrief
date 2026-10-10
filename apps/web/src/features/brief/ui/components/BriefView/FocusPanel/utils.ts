import type { AttributeDisplayMeta } from "../../../../model/utils/repo-config";

/** Repo-policy and de-emphasized risks carry detail behind a disclosure. */
export function isDisclosedRisk(
  meta: AttributeDisplayMeta | undefined,
): boolean {
  return meta?.source === "repo-policy" || meta?.deEmphasized === true;
}
