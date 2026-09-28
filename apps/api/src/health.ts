import { HttpStatuses, type HttpStatus } from "types/http";
// The health surface: bare top-level `/healthz` and `/readyz`, answered ahead
// of the `/api` mount, unauthenticated, with no session middleware in the path.
//
// `/healthz` is static liveness: 200 with zero dependencies, alive even while
// the database is unreachable. `/readyz` is readiness: one `SELECT 1` through
// the process's own handle. Both answer constant tiny JSON, so neither leaks a
// version, a dependency or a tenant. A container probes `/healthz` and never
// `/readyz`, or a database blip would trigger restart churn.

const NO_STORE = {
  "content-type": "application/json",
  "cache-control": "no-store",
} as const;

function constantJson(ok: boolean, status: HttpStatus): Response {
  return new Response(JSON.stringify({ ok }), { status, headers: NO_STORE });
}

export interface HealthDeps {
  /** One `SELECT 1` through this process's handle. */
  checkReadiness(): Promise<boolean>;
}

/** Answer a health path, or `undefined` for anything else. */
export async function handleHealthRequest(
  pathname: string,
  deps: HealthDeps,
): Promise<Response | undefined> {
  if (pathname === "/healthz") {
    return constantJson(true, HttpStatuses.OK);
  }
  if (pathname === "/readyz") {
    const ready = await deps.checkReadiness();
    return ready
      ? constantJson(true, HttpStatuses.OK)
      : constantJson(false, HttpStatuses.SERVICE_UNAVAILABLE);
  }
  return undefined;
}
