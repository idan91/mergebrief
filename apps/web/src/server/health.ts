// The health surface: bare top-level `/healthz` and `/readyz`, answered in the
// server entry BEFORE the API branch and the page router, unauthenticated,
// with no session middleware in the path.
//
// `/healthz` is static liveness, alive even while the API is down. `/readyz`
// is this tier's dependency readiness, which is the API answering its own.
// Both answer constant tiny JSON, so nothing leaks either way, and a container
// probes `/healthz` and NEVER `/readyz`, or an upstream blip would trigger
// restart churn.
import "@tanstack/react-start/server-only";

import { getApiTransport } from "./api/transport";

export interface HealthDeps {
  /** This tier's one dependency: `checkApiReadiness` below. */
  checkReadiness(): Promise<boolean>;
}

/** Readiness budget: a probe answers or it does not, it never hangs. */
const READINESS_TIMEOUT_MS = 2000;

/**
 * The API's own `/readyz`, which is where the database check now lives. A
 * misconfigured origin, an unreachable API and a database the API cannot
 * reach are one answer here, leaking none of the three.
 */
export async function checkApiReadiness(): Promise<boolean> {
  try {
    const transport = getApiTransport();
    const response = await transport.fetch(`${transport.origin}/readyz`, {
      signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const NO_STORE = {
  "content-type": "application/json",
  "cache-control": "no-store",
} as const;

function constantJson(ok: boolean, status: number): Response {
  return new Response(JSON.stringify({ ok }), { status, headers: NO_STORE });
}

/**
 * Answer a health path, or `undefined` for anything else (the entry falls
 * through to the Hono branch / page router).
 */
export async function handleHealthRequest(
  pathname: string,
  deps: HealthDeps,
): Promise<Response | undefined> {
  if (pathname === "/healthz") {
    return constantJson(true, 200);
  }
  if (pathname === "/readyz") {
    const ready = await deps.checkReadiness();
    return ready ? constantJson(true, 200) : constantJson(false, 503);
  }
  return undefined;
}
