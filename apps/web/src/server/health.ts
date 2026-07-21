// The health surface (BRIEF-51, ADR 0034 #7): bare top-level `/healthz` +
// `/readyz`, answered in the server entry BEFORE the Hono branch and the
// page router — deliberately outside `/api`, unauthenticated (cohort norm),
// zero interaction with session middleware or the Bearer carve-out.
//
// `/healthz` is static liveness: 200 with zero dependencies, alive even
// while Hono-app composition is failing. `/readyz` is readiness: the webhook
// composition resolves and one `SELECT 1` round-trips. Both answer constant
// tiny JSON — no version, dependency, or tenant detail leaks either way.
// Compose probes `/healthz` and NEVER `/readyz` (a DB blip must not trigger
// restart churn).

export interface HealthDeps {
  /** Composition + `SELECT 1` — `checkReadiness` in `webhookApp.ts`. */
  checkReadiness(): Promise<boolean>;
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
