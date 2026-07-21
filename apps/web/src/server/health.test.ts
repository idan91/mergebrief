// Health surface (BRIEF-51, ADR 0034 #7): /healthz static liveness, /readyz
// composition + SELECT 1 — constant tiny JSON either way, nothing leaked.
import { describe, expect, it } from "vitest";
import { handleHealthRequest } from "./health";

describe("handleHealthRequest", () => {
  it("answers /healthz 200 with constant JSON, no readiness probe", async () => {
    let probed = false;
    const res = await handleHealthRequest("/healthz", {
      checkReadiness: async () => {
        probed = true;
        return true;
      },
    });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true });
    expect(probed).toBe(false);
  });

  it("answers /readyz 200 when the readiness probe passes", async () => {
    const res = await handleHealthRequest("/readyz", {
      checkReadiness: async () => true,
    });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true });
  });

  it("answers /readyz 503 with the same constant shape when the probe fails", async () => {
    const res = await handleHealthRequest("/readyz", {
      checkReadiness: async () => false,
    });
    expect(res?.status).toBe(503);
    expect(await res?.json()).toEqual({ ok: false });
  });

  it("never caches a health answer", async () => {
    const res = await handleHealthRequest("/healthz", {
      checkReadiness: async () => true,
    });
    expect(res?.headers.get("cache-control")).toBe("no-store");
  });

  it("returns undefined for every other path", async () => {
    for (const path of ["/", "/api/version", "/healthz/extra", "/briefs/x"]) {
      expect(
        await handleHealthRequest(path, { checkReadiness: async () => true }),
      ).toBeUndefined();
    }
  });
});
