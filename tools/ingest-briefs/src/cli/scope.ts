import { isInstallationId, isReviewerId, type ScopeContext } from "persistence";

/** `--target user:<id>` / `installation:<id>` → the EXPLICIT ingest scope. */
export function buildTargetContext(target: string): ScopeContext {
  const [kind, rawId] = target.split(":");
  const id = BigInt(rawId ?? "0");
  if (kind === "installation" && isInstallationId(id)) {
    return { installationId: id };
  }
  if (kind === "user" && isReviewerId(id)) {
    return { ownerUserId: id };
  }
  throw new Error(`unusable --target: ${target}`);
}
