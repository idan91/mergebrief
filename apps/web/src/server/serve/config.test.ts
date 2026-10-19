import { describe, expect, it } from "vitest";
import { loadWebServerConfig } from "./config";

describe("loadWebServerConfig", () => {
  it("listens on every interface at 3000 by default", () => {
    const config = loadWebServerConfig({});

    expect(config).toEqual({
      ok: true,
      value: {
        hostname: "0.0.0.0",
        port: 3000,
        allowedHosts: new Set(["localhost"]),
      },
    });
  });

  it("takes the host, port and public URL from the env", () => {
    const config = loadWebServerConfig({
      MERGEBRIEF_WEB_HOST: "127.0.0.1",
      MERGEBRIEF_WEB_PORT: "3100",
      PUBLIC_BASE_URL: "https://brief.example.com",
    });

    expect(config).toEqual({
      ok: true,
      value: {
        hostname: "127.0.0.1",
        port: 3100,
        allowedHosts: new Set(["localhost", "brief.example.com"]),
      },
    });
  });

  it("refuses a port that is not a port", () => {
    const config = loadWebServerConfig({ MERGEBRIEF_WEB_PORT: "http" });

    expect(config).toEqual({
      ok: false,
      error: "MERGEBRIEF_WEB_PORT is invalid",
    });
  });

  it("refuses an unparseable public URL", () => {
    expect(loadWebServerConfig({ PUBLIC_BASE_URL: "nope" }).ok).toBe(false);
  });
});
