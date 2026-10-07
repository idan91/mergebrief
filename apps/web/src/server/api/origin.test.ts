import { describe, expect, it } from "vitest";
import {
  API_ORIGIN_ENV_VAR,
  DEFAULT_API_ORIGIN,
  OriginErrorCodes,
  resolveApiOrigin,
} from "./origin";

describe("resolveApiOrigin", () => {
  it("falls back to the loopback default when nothing is configured", () => {
    for (const env of [{}, { [API_ORIGIN_ENV_VAR]: "" }]) {
      const resolved = resolveApiOrigin(env);
      expect(resolved).toEqual({ ok: true, value: DEFAULT_API_ORIGIN });
    }
  });

  it("keeps only the origin, so no path can ride the configuration", () => {
    const resolved = resolveApiOrigin({
      [API_ORIGIN_ENV_VAR]: "http://api:3001/some/prefix",
    });
    expect(resolved).toEqual({ ok: true, value: "http://api:3001" });
  });

  it("refuses a value no URL parser accepts", () => {
    const resolved = resolveApiOrigin({ [API_ORIGIN_ENV_VAR]: "http://[" });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.error.code).toBe(OriginErrorCodes.UNPARSEABLE);
  });

  it("refuses a scheme that is not http or https", () => {
    for (const raw of ["file:///etc/passwd", "api:3001"]) {
      const resolved = resolveApiOrigin({ [API_ORIGIN_ENV_VAR]: raw });
      expect(resolved.ok).toBe(false);
      if (resolved.ok) {
        return;
      }
      expect(resolved.error.code).toBe(OriginErrorCodes.NOT_HTTP);
    }
  });
});
