import {
  isOwnerContext,
  type InstallationId,
  type ScopeContext,
} from "persistence";
import { NotFound } from "../shared-errors/api-error";

/**
 * The installation the ctx addresses, for routes whose surface exists only
 * in the App world (installation-port GitHub calls, per-tenant caches). An
 * owner-scoped viewer gets the uniform 404, the resource genuinely does not
 * exist in their world.
 */
export function requireInstallationScope(ctx: ScopeContext): InstallationId {
  if (isOwnerContext(ctx)) {
    throw new NotFound();
  }
  return ctx.installationId;
}
